// ==UserScript==
// @name         Academic Command Center - WhatsApp Web Collector
// @namespace    http://academic-command-center.local/
// @version      3.0.0
// @description  Automated 2-hour academic message collector with September 10 historical backfill, per-group cursors, and group discovery.
// @author       Academic Command Center
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ===========================================================================
  // 1. CONFIGURATION
  // ===========================================================================
  const CONFIG = {
    // URL of your local Academic Command Center backend
    backendUrl: "http://localhost:3000",

    // Collector authentication secret matching server-side COLLECTOR_SECRET in .env.local
    // NEVER put Gemini API key, Supabase keys, or Notion tokens here!
    collectorSecret: "change-me",

    // Initial historical backfill start boundary (Asia/Kolkata timezone)
    // Only used for initial backfill; future scans resume from persistent per-group cursor
    backfillStartDate: "2026-09-10T00:00:00+05:30",

    // Recurring scan cycle interval (default: 2 hours; configurable for testing)
    scanIntervalMs: 2 * 60 * 60 * 1000,

    // Automatically navigate between discovered WhatsApp group chats during scan cycle
    // Production default: true. Set to false to disable automatic switching.
    autoNavigateGroups: true,

    // Automatically monitor all WhatsApp group chats (no manual allowlist required)
    monitorAllGroups: true,

    // Reference group list (also used if monitorAllGroups is set to false)
    monitoredGroups: [
      "CSE-C Announcements",
      "23cse351 FoDS G1",
      "23CSE351",
      "FoDS",
      "NLP 2026 batch",
      "NLP 2026",
      "CSE-C Official 2024",
      "Machine Learning CSE-C",
      "Computer Networks CSE-C"
    ],

    // Safety limits for virtual scrolling and scan execution
    maxScrollAttempts: 30,
    maxScanDurationMs: 5 * 60 * 1000, // 5 minutes max per scan cycle
    cacheSize: 500,
    debug: true
  };

  // ===========================================================================
  // 2. STATE & DEDUPLICATION CACHE
  // ===========================================================================
  const processedMessageIds = new Set();
  const processedMessageHashes = new Set();
  let currentActiveChat = null;
  let currentIsGroup = false;

  // Scan lifecycle state
  let isScanRunning = false;
  let collectorState = "IDLE"; // IDLE, DISCOVERING_GROUPS, BACKFILLING, MONITORING, SCANNING, PERSONAL_CHAT_IGNORED, ERROR, WHATSAPP_UNAVAILABLE
  let lastScanStartedAt = null;
  let lastScanCompletedAt = null;
  let currentScanId = null;

  let stats = {
    received: 0,
    filteredChatter: 0,
    sentToBackend: 0,
    errors: 0,
    groupsDiscovered: 0,
    groupsCompleted: 0,
    groupsFailed: 0
  };

  function log(...args) {
    if (CONFIG.debug) {
      console.log("[AcademicCollector]", ...args);
    }
  }

  function hashSimple(str) {
    let hash = 0;
    const clean = str.trim().toLowerCase().replace(/\s+/g, " ");
    for (let i = 0; i < clean.length; i++) {
      const char = clean.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return String(hash);
  }

  function isDuplicate(msgId, text) {
    if (msgId && processedMessageIds.has(msgId)) return true;
    const textHash = hashSimple(text);
    if (processedMessageHashes.has(textHash)) return true;
    return false;
  }

  function markAsProcessed(msgId, text) {
    if (msgId) {
      processedMessageIds.add(msgId);
      if (processedMessageIds.size > CONFIG.cacheSize) {
        const first = processedMessageIds.values().next().value;
        if (first) processedMessageIds.delete(first);
      }
    }
    const textHash = hashSimple(text);
    processedMessageHashes.add(textHash);
    if (processedMessageHashes.size > CONFIG.cacheSize) {
      const first = processedMessageHashes.values().next().value;
      if (first) processedMessageHashes.delete(first);
    }
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // 3. WHATSAPP WEB DOM SELECTOR HELPERS
  // Centralized selectors with defensive null checks for DOM resilience.
  // ===========================================================================
  const SELECTORS = {
    // Current open chat title in the conversation header
    chatTitle: [
      "#main header span[dir='auto'][title]",
      "#main header span[dir='auto']",
      "#main header [role='heading']",
      "header span[title]",
      "header span._ao3e"
    ],
    // Secondary subtitle line in the conversation header (participant info or status)
    chatSubtitle: [
      "#main header span[title].x1f66pv5",
      "#main header span._ao3e[title]",
      "#main header span[dir='auto']._amie",
      "#main header div[role='button'] span[dir='auto']",
      "#main header div._amif span",
      "#main header div.x10l6tqk span",
      "header div[role='button'] span[dir='auto']"
    ],
    // Header click target / button (e.g., "Group info" vs "Contact info")
    headerInfoButton: [
      "#main header [role='button'][aria-label*='info' i]",
      "#main header [role='button'][title*='info' i]",
      "#main header div[role='button']",
      "#main header [data-testid='conversation-info-header']"
    ],
    // Group icons / avatars
    groupIcons: [
      "#main header [data-icon*='group']",
      "#main header [data-testid*='group']",
      "#main header [data-icon='community']",
      "#main header [data-testid='community']",
      "#main header [data-icon='announcement']",
      "#main header [aria-label*='group' i]",
      "#main header [aria-label*='community' i]"
    ],
    // Personal user icons / avatars
    userIcons: [
      "#main header [data-icon='default-user']",
      "#main header [data-testid='default-user']",
      "#main header [aria-label*='profile' i]"
    ],
    // Message container elements in the active chat view
    messageContainers: [
      "div[data-id]",
      "div.message-in",
      "div.message-out",
      "div[role='row']"
    ],
    // Author header line above incoming messages in groups
    authorHeaders: [
      "#main span[data-testid='author']",
      "#main span[dir='auto']._ahk_",
      "#main span._ahk-",
      "#main span[dir='auto']._al4b"
    ],
    // Text inside a message bubble
    messageText: [
      "span.selectable-text",
      "span._ao3e",
      "div.copyable-text",
      "span[dir='ltr']"
    ],
    // Copyable text wrapper containing pre-plain-text attribute
    copyableText: [
      "div.copyable-text[data-pre-plain-text]",
      "[data-pre-plain-text]"
    ],
    // Sidebar chat elements for discovery
    sidebarChatRows: [
      "#pane-side div[role='listitem']",
      "#pane-side div[role='row']",
      "#pane-side div[data-testid='cell-frame-container']",
      "#pane-side div._ak72",
      "#pane-side div.x10l6tqk"
    ]
  };

  function queryFirst(parent, selectorList) {
    for (const sel of selectorList) {
      try {
        const el = parent.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function getActiveChatName() {
    const mainEl = document.getElementById("main") || document;
    for (const sel of SELECTORS.chatTitle) {
      try {
        const el = mainEl.querySelector(sel);
        if (el) {
          const title = el.getAttribute("title") || el.textContent;
          if (title && title.trim().length > 0) {
            return title.trim();
          }
        }
      } catch (_) {}
    }
    return null;
  }

  // ===========================================================================
  // 4. GROUP CHAT DETECTION HELPER (GROUP vs PERSONAL 1-to-1)
  // Multi-strategy detection using semantic DOM signals without scraping history.
  // ===========================================================================
  function isGroupChat() {
    const mainEl = document.getElementById("main");
    if (!mainEl) return false;

    // Strategy 1: Inspect Header Action Label / Title (most direct semantic signal)
    for (const sel of SELECTORS.headerInfoButton) {
      try {
        const btn = mainEl.querySelector(sel);
        if (btn) {
          const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || "").toLowerCase();
          if (label.includes("group info") || label.includes("community info") || label.includes("group details")) {
            return true;
          }
          if (label.includes("contact info") || label.includes("profile info")) {
            return false;
          }
        }
      } catch (_) {}
    }

    // Strategy 2: Header Icons & Avatars
    for (const sel of SELECTORS.groupIcons) {
      try {
        if (mainEl.querySelector(sel)) {
          return true;
        }
      } catch (_) {}
    }
    for (const sel of SELECTORS.userIcons) {
      try {
        if (mainEl.querySelector(sel)) {
          return false;
        }
      } catch (_) {}
    }

    // Strategy 3: Header Subtitle / Participant Information
    for (const sel of SELECTORS.chatSubtitle) {
      try {
        const subEl = mainEl.querySelector(sel);
        if (subEl) {
          const subText = (subEl.getAttribute("title") || subEl.textContent || "").toLowerCase().trim();
          if (subText) {
            // Explicit negative check: Personal status indicators
            if (
              subText === "online" ||
              subText.startsWith("last seen") ||
              subText === "typing..." ||
              subText === "recording audio..."
            ) {
              return false;
            }

            // Explicit positive check: Group indicators
            if (
              subText.includes("participants") ||
              subText.includes("members") ||
              subText.includes("group info") ||
              subText.includes("tap here for group info") ||
              subText.includes("click here for group info") ||
              subText.includes("community") ||
              subText.includes("announcement")
            ) {
              return true;
            }

            // Participant list format: "Alice, Bob, You..." or contains multiple commas
            if (subText.includes(",") && (subText.includes("you") || subText.split(",").length >= 2)) {
              return true;
            }
          }
        }
      } catch (_) {}
    }

    // Strategy 4: Message Bubble Author Headers
    for (const sel of SELECTORS.authorHeaders) {
      try {
        const authorEl = mainEl.querySelector(sel);
        if (authorEl && authorEl.textContent?.trim().length > 0) {
          return true;
        }
      } catch (_) {}
    }

    // Strategy 5: Inspect active sidebar row in #pane-side if available
    try {
      const activeRow = document.querySelector("#pane-side [aria-selected='true']");
      if (activeRow) {
        for (const sel of SELECTORS.groupIcons) {
          if (activeRow.querySelector(sel)) return true;
        }
      }
    } catch (_) {}

    return false;
  }

  function isGroupMonitored(chatName) {
    if (!currentIsGroup) return false;
    if (CONFIG.monitorAllGroups) return true;
    if (!chatName) return false;
    const lower = chatName.toLowerCase();
    const list = CONFIG.monitoredGroups || [];
    return list.some(g => lower.includes(g.toLowerCase()));
  }

  // ===========================================================================
  // 5. TIMESTAMP PARSER & BOUNDARY CHECKS
  // ===========================================================================
  function parseWhatsAppMessageTimestamp(rawText) {
    if (!rawText) return new Date().toISOString();
    const trimmed = rawText.trim();

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    let p1 = "";
    let p2 = "";

    const bracketMatch = trimmed.match(/\[\s*(.*?)\s*,\s*(.*?)\s*\]/);
    if (bracketMatch) {
      p1 = bracketMatch[1].trim();
      p2 = bracketMatch[2].trim();
    } else if (trimmed.includes(",")) {
      const parts = trimmed.split(",");
      p1 = parts[0].trim();
      p2 = parts.slice(1).join(",").trim();
    }

    if (p1 && p2) {
      let datePart = p1;
      let timePart = p2;

      if (!/\d{1,4}[/-]\d{1,2}[/-]\d{2,4}/.test(datePart) && /\d{1,4}[/-]\d{1,2}[/-]\d{2,4}/.test(timePart)) {
        datePart = p2;
        timePart = p1;
      }

      let year = 2026;
      let month = 9;
      let day = 10;

      const dmyMatch = datePart.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
      if (dmyMatch) {
        day = parseInt(dmyMatch[1], 10);
        month = parseInt(dmyMatch[2], 10);
        let y = parseInt(dmyMatch[3], 10);
        year = y < 100 ? 2000 + y : y;
      }

      let hours = 0;
      let minutes = 0;
      let seconds = 0;

      const timeMatch = timePart.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
        if (timeMatch[3]) seconds = parseInt(timeMatch[3], 10);
        const meridian = timeMatch[4]?.toLowerCase();
        if (meridian === "pm" && hours < 12) hours += 12;
        if (meridian === "am" && hours === 12) hours = 0;
      }

      const pad2 = n => (n < 10 ? `0${n}` : `${n}`);
      const isoString = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}+05:30`;
      const parsedDate = new Date(isoString);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString();
      }
    }

    const direct = new Date(trimmed);
    if (!isNaN(direct.getTime())) {
      return direct.toISOString();
    }

    return new Date().toISOString();
  }

  function isEligibleDate(timestampIso) {
    try {
      const msgTime = new Date(timestampIso).getTime();
      const boundaryTime = new Date(CONFIG.backfillStartDate).getTime();
      return msgTime >= boundaryTime;
    } catch (_) {
      return true;
    }
  }

  function isNewerThanCursor(timestampIso, cursorTimestamp) {
    if (!cursorTimestamp) return true;
    try {
      const msgTime = new Date(timestampIso).getTime();
      const cursorTime = new Date(cursorTimestamp).getTime();
      return msgTime > cursorTime;
    } catch (_) {
      return true;
    }
  }

  // ===========================================================================
  // 6. MESSAGE DETAILS EXTRACTION
  // ===========================================================================
  function extractMessageDetails(msgNode) {
    try {
      let text = "";
      const textEl = queryFirst(msgNode, SELECTORS.messageText);
      if (textEl) {
        text = textEl.innerText || textEl.textContent || "";
      }

      if (!text.trim()) {
        return null;
      }

      const dataId = msgNode.getAttribute("data-id") ||
        msgNode.closest("[data-id]")?.getAttribute("data-id") ||
        null;

      let sender = null;
      let timestamp = null;

      const copyableEl = queryFirst(msgNode, SELECTORS.copyableText);
      if (copyableEl) {
        const prePlainText = copyableEl.getAttribute("data-pre-plain-text");
        if (prePlainText) {
          timestamp = parseWhatsAppMessageTimestamp(prePlainText);
          const match = prePlainText.match(/\[(.*?)\s*,\s*(.*?)\]\s*(.*?):\s*$/);
          if (match) {
            sender = match[3]?.trim();
          }
        }
      }

      if (!sender) {
        const authorEl = queryFirst(msgNode, SELECTORS.authorHeaders);
        if (authorEl) {
          sender = authorEl.textContent?.trim() || null;
        }
      }

      return {
        id: dataId,
        text: text.trim(),
        sender: sender || undefined,
        timestamp: timestamp || new Date().toISOString()
      };
    } catch (err) {
      log("Error extracting message details:", err);
      return null;
    }
  }

  // ===========================================================================
  // 7. LOCAL MESSAGE FILTER (CONSERVATIVE PRE-FILTER)
  // ===========================================================================
  const ACADEMIC_KEYWORDS = [
    "assignment", "submit", "submission", "deadline", "due", "exam", "test",
    "slip test", "quiz", "lab", "project", "presentation", "viva", "course",
    "certificate", "certification", "class", "internal", "assessment", "marks",
    "grade", "attendance", "postponed", "rescheduled", "cancelled", "canceled",
    "extended", "link", "tomorrow", "today", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday", "sunday", "portal", "classroom", "gcr",
    "moodle", "drive.google.com", "forms.gle", "docs.google.com", "hour",
    "period", "session", "hall ticket", "syllabus", "fods", "data science"
  ];

  const CLEAR_CHATTER_EXACT = new Set([
    "hi", "hello", "hey", "ok", "k", "okay", "thanks", "thank you", "thx",
    "good morning", "gm", "good afternoon", "good evening", "good night", "gn",
    "happy birthday", "hbd", "congrats", "congratulations", "yes", "no", "fine",
    "cool", "lol", "lmao", "done", "noted", "+1", "👍", "👌", "🙏", "😂", "❤️", "🎉"
  ]);

  function passesLocalFilter(text) {
    const clean = text.trim();
    const lower = clean.toLowerCase();

    if (CLEAR_CHATTER_EXACT.has(lower)) {
      return false;
    }

    const emojiOrSymbolOnly = /^[\p{Emoji}\s\d\W]+$/u.test(clean) && !/[a-zA-Z]{3,}/.test(clean);
    if (emojiOrSymbolOnly && !clean.includes("http")) {
      return false;
    }

    const hasUrl = /https?:\/\/[^\s]+/i.test(clean);
    const hasAcademicKeyword = ACADEMIC_KEYWORDS.some(kw => lower.includes(kw));

    if (clean.length < 10 && !hasUrl && !hasAcademicKeyword) {
      return false;
    }

    if (hasAcademicKeyword || hasUrl) {
      return true;
    }

    if (/\b[0-9]{2}[A-Z]{3}[0-9]{3}\b/i.test(clean) || /\b[A-Z]{2,4}[0-9]{3}\b/i.test(clean)) {
      return true;
    }

    return clean.length >= 25;
  }

  // ===========================================================================
  // 8. BACKEND API CLIENT (GM_xmlhttpRequest)
  // ===========================================================================
  function apiRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = `${CONFIG.backendUrl.replace(/\/+$/, "")}${endpoint}`;
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CONFIG.collectorSecret}`
        },
        data: data ? JSON.stringify(data) : undefined,
        timeout: 15000,
        onload: function (res) {
          try {
            const json = JSON.parse(res.responseText);
            if (res.status >= 200 && res.status < 300) {
              resolve({ status: res.status, data: json });
            } else {
              reject(new Error(json.error || `HTTP ${res.status}`));
            }
          } catch (_) {
            if (res.status >= 200 && res.status < 300) {
              resolve({ status: res.status, data: res.responseText });
            } else {
              reject(new Error(`HTTP ${res.status}`));
            }
          }
        },
        onerror: err => reject(err),
        ontimeout: () => reject(new Error("Request timed out"))
      });
    });
  }

  async function reportCollectorStatus(payload) {
    try {
      await apiRequest("POST", "/api/collector/status", payload);
    } catch (err) {
      log("Error reporting collector status:", err.message);
    }
  }

  async function fetchGroupState(groupName) {
    try {
      const res = await apiRequest("GET", `/api/collector/groups/${encodeURIComponent(groupName)}`);
      return res.data?.group || null;
    } catch (_) {
      return null;
    }
  }

  async function updateGroupCursor(groupName, updates) {
    try {
      const res = await apiRequest("PATCH", `/api/collector/groups/${encodeURIComponent(groupName)}/cursor`, updates);
      return res.data?.group || null;
    } catch (err) {
      log("Failed to update group cursor:", err.message);
      return null;
    }
  }

  async function sendAcademicMessage(payload) {
    return await apiRequest("POST", "/api/collector/messages", payload);
  }

  // ===========================================================================
  // 9. GROUP DISCOVERY
  // Scans #pane-side to identify all available WhatsApp GROUP chats.
  // ===========================================================================
  function discoverSidebarGroups() {
    const pane = document.getElementById("pane-side");
    if (!pane) return [];

    const discovered = [];
    const seenTitles = new Set();

    // Query chat rows in the sidebar
    for (const sel of SELECTORS.sidebarChatRows) {
      const rows = pane.querySelectorAll(sel);
      if (rows && rows.length > 0) {
        rows.forEach(row => {
          try {
            // Find chat name
            const titleEl = row.querySelector("span[title]") || row.querySelector("span[dir='auto']");
            const title = (titleEl?.getAttribute("title") || titleEl?.textContent || "").trim();
            if (!title || seenTitles.has(title)) return;

            // Semantic check for group in the sidebar row:
            // 1. Group / community icons
            let isGroup = false;
            for (const iconSel of SELECTORS.groupIcons) {
              if (row.querySelector(iconSel)) {
                isGroup = true;
                break;
              }
            }

            // 2. Look for member delimiter in preview e.g. "Alice: hello"
            const previewEl = row.querySelector("span[dir='ltr']") || row.querySelector("._ak8j");
            const previewText = previewEl?.textContent || "";
            if (!isGroup && previewText.includes(": ")) {
              isGroup = true;
            }

            // 3. Known monitored list inclusion
            if (!isGroup && CONFIG.monitoredGroups.some(g => title.toLowerCase().includes(g.toLowerCase()))) {
              isGroup = true;
            }

            if (isGroup) {
              seenTitles.add(title);
              discovered.push({
                name: title,
                element: row
              });
            }
          } catch (_) {}
        });
      }
    }

    return discovered;
  }

  // ===========================================================================
  // 10. VIRTUAL SCROLLING & HISTORICAL BACKFILL ENGINE
  // Scrolls upward until messages reach September 10, 2026.
  // ===========================================================================
  function findMessageScrollContainer() {
    const mainEl = document.getElementById("main");
    if (!mainEl) return null;

    // Search for the scrollable container inside #main
    const candidates = mainEl.querySelectorAll("div");
    for (const c of candidates) {
      if (c.scrollHeight > c.clientHeight && c.clientHeight > 200) {
        const overflowY = window.getComputedStyle(c).overflowY;
        if (overflowY === "scroll" || overflowY === "auto") {
          return c;
        }
      }
    }

    return mainEl.querySelector("[tabindex='-1']") || mainEl.querySelector(".copyable-area") || mainEl;
  }

  function getRenderedMessages() {
    const mainEl = document.getElementById("main");
    if (!mainEl) return [];

    const nodes = [];
    for (const sel of SELECTORS.messageContainers) {
      const found = mainEl.querySelectorAll(sel);
      if (found && found.length > 0) {
        found.forEach(n => {
          const details = extractMessageDetails(n);
          if (details && details.text) {
            nodes.push(details);
          }
        });
        break;
      }
    }

    // Sort chronologically
    return nodes.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  async function scrollUpToBackfillBoundary() {
    const container = findMessageScrollContainer();
    if (!container) return;

    log("Virtual scrolling upward for September 10 boundary...");
    let attempts = 0;
    let lastEarliestTimestamp = null;
    let reachedBoundary = false;

    while (attempts < CONFIG.maxScrollAttempts) {
      attempts++;
      const currentMessages = getRenderedMessages();
      if (currentMessages.length > 0) {
        const earliest = currentMessages[0];
        lastEarliestTimestamp = earliest.timestamp;

        // Check if we reached or crossed September 10
        if (!isEligibleDate(earliest.timestamp)) {
          log("Reached September 10 backfill boundary! Earliest message is:", earliest.timestamp);
          reachedBoundary = true;
          break;
        }
      }

      // Scroll upward
      const prevScrollHeight = container.scrollHeight;
      container.scrollTop = 0;

      // Small delay for WhatsApp Web to load older messages into DOM
      await delay(700);

      // If scrollHeight didn't change and we're at top, we reached chat start
      if (container.scrollHeight === prevScrollHeight && attempts > 3) {
        log("No more older messages available in WhatsApp Web chat history.");
        reachedBoundary = true;
        break;
      }
    }

    return {
      reachedBoundary,
      earliestTimestamp: lastEarliestTimestamp
    };
  }

  // ===========================================================================
  // 11. PER-GROUP SCAN EXECUTION
  // ===========================================================================
  async function scanSingleGroup(groupItem) {
    const groupName = groupItem.name;
    log(`Starting scan for group: "${groupName}"`);

    // 1. Click sidebar chat to open conversation
    try {
      groupItem.element.click();
    } catch (_) {
      const clickTarget = groupItem.element.querySelector("div[role='gridcell']") || groupItem.element;
      clickTarget.click();
    }

    await delay(1200);

    // 2. Strict Privacy Boundary: Verify this is genuinely a GROUP
    const isGroup = isGroupChat();
    if (!isGroup) {
      log(`Privacy guard: "${groupName}" evaluated as personal chat. Skipping.`);
      collectorState = "PERSONAL_CHAT_IGNORED";
      updateStatusBadge();
      return { status: "SKIPPED_PERSONAL" };
    }

    // 3. Fetch persistent cursor from server
    let groupState = await fetchGroupState(groupName);
    const isBackfill = !groupState || !groupState.backfillComplete;

    collectorState = isBackfill ? "BACKFILLING" : "SCANNING";
    updateStatusBadge();

    await reportCollectorStatus({
      currentGroup: groupName,
      chatType: "GROUP",
      collectionStatus: isBackfill ? "BACKFILLING" : "ACTIVE",
      whatsappAvailable: true
    });

    // 4. If backfill not complete, scroll upward to reach September 10
    if (isBackfill) {
      await scrollUpToBackfillBoundary();
    }

    // 5. Gather rendered messages in chronological order
    const renderedMessages = getRenderedMessages();
    log(`Inspect ${renderedMessages.length} rendered messages in "${groupName}"`);

    let processedCount = 0;
    let ignoredCount = 0;
    let newestProcessedTimestamp = groupState?.lastProcessedMessageTimestamp || null;
    let newestProcessedId = groupState?.lastProcessedMessageId || null;
    let scanError = null;

    for (const msg of renderedMessages) {
      // Rule 1: September 10 boundary check
      if (!isEligibleDate(msg.timestamp)) {
        ignoredCount++;
        continue;
      }

      // Rule 2: Incremental cursor check (skip already processed messages)
      if (groupState?.lastProcessedMessageTimestamp && !isNewerThanCursor(msg.timestamp, groupState.lastProcessedMessageTimestamp)) {
        continue;
      }

      // Deduplication check
      if (isDuplicate(msg.id, msg.text)) {
        continue;
      }

      markAsProcessed(msg.id, msg.text);
      stats.received++;

      // Filter non-academic chatter
      if (!passesLocalFilter(msg.text)) {
        stats.filteredChatter++;
        ignoredCount++;
        // We can safely advance cursor past chatter
        newestProcessedTimestamp = msg.timestamp;
        newestProcessedId = msg.id || newestProcessedId;
        continue;
      }

      // Send to backend
      try {
        const res = await sendAcademicMessage({
          message: msg.text,
          sourceGroup: groupName,
          sourceSender: msg.sender,
          messageTimestamp: msg.timestamp,
          sourceMessageId: msg.id || undefined
        });

        stats.sentToBackend++;
        processedCount++;

        // Only advance cursor upon successful processing
        newestProcessedTimestamp = msg.timestamp;
        newestProcessedId = msg.id || newestProcessedId;
      } catch (err) {
        log(`Failed sending message to backend for group "${groupName}":`, err.message);
        stats.errors++;
        scanError = err.message;
        // Strict requirement: DO NOT advance cursor past failed message!
        break;
      }
    }

    // 6. Update Group Cursor and Completion Status
    const backfillCompleteNow = Boolean(
      (groupState?.backfillComplete) ||
      (isBackfill && !scanError)
    );

    await updateGroupCursor(groupName, {
      groupName,
      lastProcessedMessageTimestamp: newestProcessedTimestamp,
      lastProcessedMessageId: newestProcessedId,
      backfillComplete: backfillCompleteNow,
      status: scanError ? "ERROR" : "MONITORING",
      lastError: scanError || null,
      messagesScannedIncrement: renderedMessages.length,
      messagesProcessedIncrement: processedCount,
      messagesIgnoredIncrement: ignoredCount
    });

    log(`Completed scan for "${groupName}". Processed: ${processedCount}, Ignored: ${ignoredCount}, BackfillComplete: ${backfillCompleteNow}`);
    return {
      status: scanError ? "FAILED" : "COMPLETED",
      error: scanError
    };
  }

  // ===========================================================================
  // 12. TWO-HOUR SCAN CYCLE SCHEDULER & SCAN LOCK
  // ===========================================================================
  async function runFullScanCycle() {
    // Scan Lock: Prevent concurrent scans
    if (isScanRunning) {
      log("Scan already in progress. Skipping concurrent cycle trigger.");
      return;
    }

    isScanRunning = true;
    lastScanStartedAt = new Date().toISOString();
    collectorState = "DISCOVERING_GROUPS";
    updateStatusBadge();

    log("=== STARTING ACADEMIC COMMAND CENTER 2-HOUR SCAN CYCLE ===");

    // Verify WhatsApp Web availability
    const pane = document.getElementById("pane-side");
    if (!pane) {
      log("WhatsApp Web unavailable (pane-side not found). Reporting unavailable.");
      collectorState = "WHATSAPP_UNAVAILABLE";
      updateStatusBadge();
      await reportCollectorStatus({ whatsappAvailable: false });
      isScanRunning = false;
      return;
    }

    // Start scan record in backend
    let scanRecordId = null;
    try {
      const scanRes = await apiRequest("POST", "/api/collector/scans", {
        startedAt: lastScanStartedAt,
        status: "IN_PROGRESS"
      });
      scanRecordId = scanRes.data?.scan?.id || null;
      currentScanId = scanRecordId;
    } catch (_) {}

    try {
      // 1. Discover all WhatsApp group chats
      const groups = discoverSidebarGroups();
      stats.groupsDiscovered = groups.length;
      log(`Discovered ${groups.length} eligible WhatsApp group chats.`);

      let completedCount = 0;
      let failedCount = 0;

      // 2. Sequential group scan
      if (CONFIG.autoNavigateGroups && groups.length > 0) {
        for (const grp of groups) {
          try {
            const res = await scanSingleGroup(grp);
            if (res.status === "COMPLETED") {
              completedCount++;
            } else if (res.status === "FAILED") {
              failedCount++;
            }
          } catch (grpErr) {
            log(`Error scanning group "${grp.name}":`, grpErr);
            failedCount++;
            await updateGroupCursor(grp.name, {
              status: "ERROR",
              lastError: grpErr.message
            });
          }
          await delay(1000);
        }
      } else {
        // In manual / current-chat mode: scan active group
        const activeName = getActiveChatName();
        if (activeName && isGroupChat()) {
          await scanSingleGroup({ name: activeName, element: document });
          completedCount++;
        }
      }

      stats.groupsCompleted += completedCount;
      stats.groupsFailed += failedCount;
      lastScanCompletedAt = new Date().toISOString();
      collectorState = "IDLE";
      updateStatusBadge();

      // Finish scan record in backend
      if (scanRecordId) {
        await apiRequest("POST", "/api/collector/scans", {
          id: scanRecordId,
          completedAt: lastScanCompletedAt,
          status: failedCount > 0 && completedCount === 0 ? "FAILED" : "COMPLETED",
          groupsDiscovered: groups.length,
          groupsCompleted: completedCount,
          groupsFailed: failedCount
        }).catch(() => {});
      }

      await reportCollectorStatus({
        collectionStatus: "ACTIVE",
        whatsappAvailable: true
      });

      log("=== 2-HOUR SCAN CYCLE COMPLETED SUCCESSFULLY ===");
    } catch (err) {
      log("Scan cycle encountered unexpected error:", err);
      collectorState = "ERROR";
      updateStatusBadge();
      if (scanRecordId) {
        await apiRequest("POST", "/api/collector/scans", {
          id: scanRecordId,
          completedAt: new Date().toISOString(),
          status: "FAILED",
          error: err.message
        }).catch(() => {});
      }
    } finally {
      isScanRunning = false;
      collectorState = "IDLE";
      updateStatusBadge();
    }
  }

  // ===========================================================================
  // 13. MUTATION OBSERVER & LIVE CHAT SWITCHING
  // Observes new incoming messages between scan cycles
  // ===========================================================================
  let observer = null;

  function markExistingMessagesAsSeen() {
    const mainEl = document.getElementById("main");
    if (!mainEl) return;

    for (const sel of SELECTORS.messageContainers) {
      const existing = mainEl.querySelectorAll(sel);
      existing.forEach(node => {
        const details = extractMessageDetails(node);
        if (details) {
          markAsProcessed(details.id, details.text);
        }
      });
    }
  }

  function handleChatSwitch() {
    const activeChat = getActiveChatName();
    if (!activeChat) {
      if (currentActiveChat !== null) {
        currentActiveChat = null;
        currentIsGroup = false;
        updateStatusBadge();
      }
      return;
    }

    const isGroup = isGroupChat();

    if (activeChat !== currentActiveChat || isGroup !== currentIsGroup) {
      currentActiveChat = activeChat;
      currentIsGroup = isGroup;

      log("Chat switched:", activeChat, "Type:", isGroup ? "GROUP" : "PERSONAL");
      markExistingMessagesAsSeen();
      updateStatusBadge();

      const monitored = isGroup && isGroupMonitored(activeChat);
      reportCollectorStatus({
        currentGroup: activeChat,
        chatType: isGroup ? "GROUP" : "PERSONAL",
        collectionStatus: monitored ? "ACTIVE" : "IGNORED",
        whatsappAvailable: true
      });
    }
  }

  function startObserver() {
    if (observer) observer.disconnect();

    markExistingMessagesAsSeen();

    observer = new MutationObserver(mutations => {
      handleChatSwitch();

      // When a scan is running, let the scan loop process messages sequentially
      if (isScanRunning) return;

      // Strict privacy boundary: Only process monitored GROUP conversations
      if (!currentIsGroup || !isGroupMonitored(currentActiveChat)) {
        return;
      }

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node;
              const isMsg = SELECTORS.messageContainers.some(sel => el.matches?.(sel));
              const containers = isMsg ? [el] : Array.from(el.querySelectorAll?.(SELECTORS.messageContainers[0]) || []);

              for (const c of containers) {
                const details = extractMessageDetails(c);
                if (!details || !details.text) continue;
                if (!isEligibleDate(details.timestamp)) continue;
                if (isDuplicate(details.id, details.text)) continue;

                markAsProcessed(details.id, details.text);
                stats.received++;

                if (!passesLocalFilter(details.text)) {
                  stats.filteredChatter++;
                  continue;
                }

                sendAcademicMessage({
                  message: details.text,
                  sourceGroup: currentActiveChat,
                  sourceSender: details.sender,
                  messageTimestamp: details.timestamp,
                  sourceMessageId: details.id || undefined
                }).then(() => {
                  stats.sentToBackend++;
                  updateStatusBadge();
                }).catch(() => {
                  stats.errors++;
                  updateStatusBadge();
                });
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ===========================================================================
  // 14. STATUS BADGE UI (FLOATING PILL)
  // Badge states:
  // 🟢 ACC Collector: Monitoring Group
  // 🟡 ACC Collector: Backfilling Group
  // 🔵 ACC Collector: Scanning Groups
  // ⚪ ACC Collector: Personal Chat Ignored
  // ⚪ ACC Collector: Inactive
  // 🔴 ACC Collector: Backend Error / WhatsApp Unavailable
  // ===========================================================================
  let badgeEl = null;

  function createStatusBadge() {
    if (badgeEl) return;

    badgeEl = document.createElement("div");
    badgeEl.id = "acc-collector-badge";
    badgeEl.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 999999;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      padding: 6px 12px;
      border-radius: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border: 1px solid #334155;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
    `;

    badgeEl.title = "Academic Command Center Collector v3.0 - Click for details";
    badgeEl.addEventListener("click", () => {
      const monitored = currentIsGroup && isGroupMonitored(currentActiveChat);
      alert(
        `🎓 Academic Command Center Collector v3.0\n\n` +
        `• Active Chat: ${currentActiveChat || "None"}\n` +
        `• Chat Type: ${currentIsGroup ? (monitored ? "GROUP (Observing)" : "GROUP (Not Monitored)") : (currentActiveChat ? "PERSONAL (Ignored)" : "None")}\n` +
        `• Collector State: ${collectorState}\n` +
        `• Scan Interval: Every 2 Hours (${CONFIG.scanIntervalMs / 60000} mins)\n` +
        `• Initial Backfill Boundary: 10 Sep 2026\n` +
        `• Groups Discovered: ${stats.groupsDiscovered}\n` +
        `• Messages Captured: ${stats.received}\n` +
        `• Filtered Chatter: ${stats.filteredChatter}\n` +
        `• Sent to Backend: ${stats.sentToBackend}\n` +
        `• Errors: ${stats.errors}\n\n` +
        `Backend: ${CONFIG.backendUrl}`
      );
    });

    document.body.appendChild(badgeEl);
    updateStatusBadge();
  }

  function updateStatusBadge() {
    if (!badgeEl) return;

    let dotColor = "#94a3b8";
    let statusText = "Inactive";

    if (collectorState === "WHATSAPP_UNAVAILABLE" || collectorState === "ERROR") {
      dotColor = "#ef4444";
      statusText = collectorState === "WHATSAPP_UNAVAILABLE" ? "WhatsApp Unavailable" : "Backend Error";
    } else if (collectorState === "BACKFILLING") {
      dotColor = "#eab308"; // Yellow
      statusText = "Backfilling Group";
    } else if (collectorState === "SCANNING" || collectorState === "DISCOVERING_GROUPS") {
      dotColor = "#38bdf8"; // Blue
      statusText = "Scanning Groups";
    } else if (currentActiveChat) {
      if (currentIsGroup) {
        if (isGroupMonitored(currentActiveChat)) {
          dotColor = "#22c55e"; // Green
          statusText = "Monitoring Group";
        } else {
          dotColor = "#eab308";
          statusText = "Group Not Monitored";
        }
      } else {
        dotColor = "#94a3b8"; // Gray
        statusText = "Personal Chat Ignored";
      }
    }

    const groupLabel = currentIsGroup && currentActiveChat
      ? `<span style="color:#38bdf8;font-weight:600;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${currentActiveChat}</span>`
      : "";

    badgeEl.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};box-shadow:0 0 6px ${dotColor}"></span>
      <span style="font-weight:600">ACC Collector:</span>
      <span>${statusText}</span>
      ${groupLabel}
      <span style="background:#1e293b;padding:2px 6px;border-radius:10px;font-size:10px;margin-left:4px">🚀 ${stats.sentToBackend}</span>
    `;
  }

  // ===========================================================================
  // 15. INITIALIZATION & RECURRING 2-HOUR SCHEDULER
  // ===========================================================================
  let scanIntervalTimer = null;

  function init() {
    log("Initializing Academic Command Center Collector v3.0 (2-Hour Scheduler & Backfill)...");
    createStatusBadge();

    // Check periodically for chat header change
    setInterval(() => {
      handleChatSwitch();
    }, 1500);

    // Start live DOM observer
    startObserver();

    // Initial scan cycle immediately upon startup
    setTimeout(() => {
      runFullScanCycle();
    }, 3000);

    // Setup recurring 2-hour scan cycle
    if (scanIntervalTimer) clearInterval(scanIntervalTimer);
    scanIntervalTimer = setInterval(() => {
      log("2-hour interval elapsed. Triggering scheduled scan cycle...");
      runFullScanCycle();
    }, CONFIG.scanIntervalMs);
  }

  // Poll for WhatsApp Web interface readiness
  const checkReadyInterval = setInterval(() => {
    const pane = document.getElementById("pane-side") || document.getElementById("app");
    if (pane) {
      clearInterval(checkReadyInterval);
      init();
    }
  }, 1000);

})();
