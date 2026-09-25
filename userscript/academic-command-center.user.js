// ==UserScript==
// @name         Academic Command Center - WhatsApp Web Collector
// @namespace    http://academic-command-center.local/
// @version      1.0.0
// @description  Securely captures academic messages from allowlisted WhatsApp groups and sends them to the local Academic Command Center.
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
  // Configure your allowed WhatsApp academic group/chat names and backend URL.
  // ===========================================================================
  const CONFIG = {
    // URL of your local Academic Command Center backend
    backendUrl: "http://localhost:3000",

    // Allowed academic group names (exact or partial matches)
    // ONLY messages in these groups will be read and processed.
    // Example: ["19CSE312 NLP Official", "CSE 2026 Announcements", "OS Lab Batch A"]
    allowedGroups: [
      "19CSE312",
      "CS301",
      "CS302",
      "CS303",
      "CSE",
      "Academic",
      "Announcements",
      "Assignments"
    ],

    // Collector authentication secret matching server-side COLLECTOR_SECRET in .env.local
    // NEVER put Gemini API key, Supabase keys, or Notion tokens here!
    collectorSecret: "change-me",

    // Maximum items to keep in client deduplication cache
    cacheSize: 500,

    // Debug logging to browser console
    debug: true
  };

  // ===========================================================================
  // 2. STATE & DEDUPLICATION CACHE
  // ===========================================================================
  const processedMessageIds = new Set();
  const processedMessageHashes = new Set();
  let collectorInitializedAt = Date.now();
  let stats = {
    received: 0,
    filteredChatter: 0,
    sentToBackend: 0,
    errors: 0
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
    // Message container elements in the active chat view
    messageContainers: [
      "div[data-id]",
      "div.message-in",
      "div.message-out",
      "div[role='row']"
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
    // Sender name element
    senderName: [
      "span[dir='auto']._ahk_",
      "span._ahk-",
      "span[dir='auto']._al4b",
      "span[data-testid='author']"
    ]
  };

  function queryFirst(parent, selectorList) {
    for (const sel of selectorList) {
      const el = parent.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getActiveChatName() {
    const mainEl = document.getElementById("main") || document;
    for (const sel of SELECTORS.chatTitle) {
      const el = mainEl.querySelector(sel);
      if (el) {
        const title = el.getAttribute("title") || el.textContent;
        if (title && title.trim().length > 0) {
          return title.trim();
        }
      }
    }
    return null;
  }

  function isGroupAllowed(chatName) {
    if (!chatName) return false;
    const lower = chatName.toLowerCase();
    return CONFIG.allowedGroups.some(allowed =>
      lower.includes(allowed.toLowerCase().trim())
    );
  }

  function extractMessageDetails(msgNode) {
    try {
      // 1. Extract message text
      let text = "";
      const textEl = queryFirst(msgNode, SELECTORS.messageText);
      if (textEl) {
        text = textEl.innerText || textEl.textContent || "";
      }

      if (!text.trim()) {
        return null;
      }

      // 2. Extract stable ID
      const dataId = msgNode.getAttribute("data-id") ||
        msgNode.closest("[data-id]")?.getAttribute("data-id") ||
        null;

      // 3. Extract sender and timestamp from copyable-text if available
      let sender = null;
      let timestamp = null;

      const copyableEl = queryFirst(msgNode, SELECTORS.copyableText);
      if (copyableEl) {
        const prePlainText = copyableEl.getAttribute("data-pre-plain-text");
        // WhatsApp format: "[11:35 am, 25/09/2026] Vignesh Vasala: "
        if (prePlainText) {
          const match = prePlainText.match(/\[(.*?)\s*,\s*(.*?)\]\s*(.*?):\s*$/);
          if (match) {
            timestamp = `${match[2]} ${match[1]}`;
            sender = match[3]?.trim();
          }
        }
      }

      // Fallback for sender if not parsed from pre-plain-text
      if (!sender) {
        const senderEl = queryFirst(msgNode, SELECTORS.senderName);
        if (senderEl) {
          sender = senderEl.textContent?.trim() || null;
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
  // 4. LOCAL MESSAGE FILTER (CONSERVATIVE PRE-FILTER)
  // Rejects clear chatter while letting academic/uncertain messages pass to Gemini.
  // ===========================================================================
  const ACADEMIC_KEYWORDS = [
    "assignment",
    "submit",
    "submission",
    "deadline",
    "due",
    "exam",
    "test",
    "slip test",
    "quiz",
    "lab",
    "project",
    "presentation",
    "viva",
    "course",
    "certificate",
    "certification",
    "class",
    "internal",
    "assessment",
    "marks",
    "grade",
    "attendance",
    "postponed",
    "rescheduled",
    "cancelled",
    "canceled",
    "extended",
    "link",
    "tomorrow",
    "today",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "portal",
    "classroom",
    "gcr",
    "moodle",
    "drive.google.com",
    "forms.gle",
    "docs.google.com",
    "hour",
    "period",
    "session",
    "hall ticket",
    "syllabus"
  ];

  const CLEAR_CHATTER_EXACT = new Set([
    "hi",
    "hello",
    "hey",
    "ok",
    "k",
    "okay",
    "thanks",
    "thank you",
    "thx",
    "good morning",
    "gm",
    "good afternoon",
    "good evening",
    "good night",
    "gn",
    "happy birthday",
    "hbd",
    "congrats",
    "congratulations",
    "yes",
    "no",
    "fine",
    "cool",
    "lol",
    "lmao",
    "done",
    "noted",
    "+1",
    "👍",
    "👌",
    "🙏",
    "😂",
    "❤️",
    "🎉"
  ]);

  function passesLocalFilter(text) {
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // 1. Check exact match chatter
    if (CLEAR_CHATTER_EXACT.has(lower)) {
      return false;
    }

    // 2. Reject pure emoji messages or single punctuation
    const emojiOrSymbolOnly = /^[\p{Emoji}\s\d\W]+$/u.test(clean) && !/[a-zA-Z]{3,}/.test(clean);
    if (emojiOrSymbolOnly && !clean.includes("http")) {
      return false;
    }

    // 3. Very short chatter (< 10 chars) without academic keyword or link
    const hasUrl = /https?:\/\/[^\s]+/i.test(clean);
    const hasAcademicKeyword = ACADEMIC_KEYWORDS.some(kw => lower.includes(kw));

    if (clean.length < 10 && !hasUrl && !hasAcademicKeyword) {
      return false;
    }

    // 4. If message has academic keyword or URL, definitely send
    if (hasAcademicKeyword || hasUrl) {
      return true;
    }

    // 5. If message mentions course code (e.g. 19CSE312, CS301), definitely send
    if (/\b[0-9]{2}[A-Z]{3}[0-9]{3}\b/i.test(clean) || /\b[A-Z]{2,4}[0-9]{3}\b/i.test(clean)) {
      return true;
    }

    // 6. For uncertain longer messages in an allowlisted academic group, send to backend
    // because Gemini is responsible for semantic interpretation
    return clean.length >= 25;
  }

  // ===========================================================================
  // 5. BACKEND DISPATCH VIA GM_xmlhttpRequest
  // Sends authenticated payload to POST /api/collector/messages
  // ===========================================================================
  function sendToBackend(payload) {
    const targetUrl = `${CONFIG.backendUrl.replace(/\/+$/, "")}/api/collector/messages`;

    log("Dispatching message to backend:", {
      group: payload.sourceGroup,
      textPreview: payload.message.slice(0, 50) + "..."
    });

    GM_xmlhttpRequest({
      method: "POST",
      url: targetUrl,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CONFIG.collectorSecret}`
      },
      data: JSON.stringify(payload),
      timeout: 10000,
      onload: function (response) {
        if (response.status >= 200 && response.status < 300) {
          stats.sentToBackend += 1;
          updateStatusBadge();
          try {
            const data = JSON.parse(response.responseText);
            log("Backend processing success:", data.action, data.item?.title || "");
          } catch (_) {
            log("Backend responded successfully:", response.status);
          }
        } else {
          stats.errors += 1;
          updateStatusBadge();
          log("Backend error response:", response.status, response.responseText);
        }
      },
      onerror: function (err) {
        stats.errors += 1;
        updateStatusBadge();
        log("Network error connecting to backend:", err);
      },
      ontimeout: function () {
        stats.errors += 1;
        updateStatusBadge();
        log("Backend request timed out.");
      }
    });
  }

  // ===========================================================================
  // 6. MESSAGE PROCESSING PIPELINE
  // ===========================================================================
  function processMessageNode(msgNode) {
    const activeChat = getActiveChatName();
    if (!activeChat) return;

    // Strict privacy boundary: Process ONLY allowlisted academic groups
    if (!isGroupAllowed(activeChat)) {
      return;
    }

    const details = extractMessageDetails(msgNode);
    if (!details || !details.text) return;

    // Deduplication check
    if (isDuplicate(details.id, details.text)) {
      return;
    }

    markAsProcessed(details.id, details.text);
    stats.received += 1;

    // Local filtering
    if (!passesLocalFilter(details.text)) {
      stats.filteredChatter += 1;
      log("Filtered local chatter:", details.text.slice(0, 30));
      updateStatusBadge();
      return;
    }

    // Send valid/potential academic message to backend
    sendToBackend({
      message: details.text,
      sourceGroup: activeChat,
      sourceSender: details.sender,
      messageTimestamp: details.timestamp,
      sourceMessageId: details.id || undefined
    });
  }

  // ===========================================================================
  // 7. MUTATION OBSERVER FOR LIVE MESSAGE CAPTURE
  // Only captures newly rendered messages; ignores pre-existing history on launch.
  // ===========================================================================
  let observer = null;
  let markedInitialMessages = false;

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

  function startObserver() {
    if (observer) observer.disconnect();

    log("Starting MutationObserver for academic messages...");

    // Mark current messages on start so we do not ingest historical messages
    markExistingMessagesAsSeen();

    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node;

              // Check if node itself is a message
              const isMsg = SELECTORS.messageContainers.some(sel => el.matches?.(sel));
              if (isMsg) {
                processMessageNode(el);
              } else {
                // Check if new node contains messages
                for (const sel of SELECTORS.messageContainers) {
                  const children = el.querySelectorAll?.(sel);
                  if (children && children.length > 0) {
                    children.forEach(c => processMessageNode(c));
                  }
                }
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
  // 8. STATUS BADGE UI (IN-PAGE FLOATING PILL)
  // Non-intrusive status indicator showing collector activity.
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

    badgeEl.title = "Academic Command Center Collector - Click to view status";
    badgeEl.addEventListener("click", () => {
      const activeChat = getActiveChatName();
      alert(
        `🎓 Academic Command Center Collector\n\n` +
        `• Active Chat: ${activeChat || "None"}\n` +
        `• Allowlisted: ${isGroupAllowed(activeChat) ? "YES ✅" : "NO ❌"}\n` +
        `• Allowed Groups Configured: ${CONFIG.allowedGroups.length}\n` +
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
    const activeChat = getActiveChatName();
    const isAllowed = isGroupAllowed(activeChat);

    const dotColor = isAllowed ? "#22c55e" : "#94a3b8";
    const statusText = isAllowed ? "Observing Group" : "Inactive (Non-academic)";

    badgeEl.innerHTML = `
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};box-shadow:0 0 6px ${dotColor}"></span>
      <span style="font-weight:600">ACC Collector:</span>
      <span>${statusText}</span>
      <span style="background:#1e293b;padding:2px 6px;border-radius:10px;font-size:10px;margin-left:4px">🚀 ${stats.sentToBackend}</span>
    `;
  }

  // ===========================================================================
  // 9. INITIALIZATION
  // Wait for WhatsApp Web to load its main interface before attaching observer.
  // ===========================================================================
  function init() {
    log("Initializing Academic Command Center Collector...");
    createStatusBadge();

    // Check periodically for chat header change to update badge
    setInterval(() => {
      updateStatusBadge();
    }, 2000);

    // Start observer
    startObserver();
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
