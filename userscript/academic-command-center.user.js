// ==UserScript==
// @name         Academic Command Center - WhatsApp Web Collector
// @namespace    http://academic-command-center.local/
// @version      3.2.1
// @description  Small floating ACC Collector status pill at bottom-left of WhatsApp Web with explicit scan lifecycle UX, auto-hide, popover summary, and cursor safety.
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
    backendUrl: "http://localhost:3000",
    collectorSecret: "change-me",
    backfillStartDate: "2026-09-10T00:00:00+05:30",

    // ONLY these 6 groups are monitored. Do not change this list.
    allowedGroups: [
      "Machine Learning CSE-C",
      "Computer Networks CSE-C",
      "TOC 23CSE303 - CSE-C",
      "NLP 2026 batch",
      "CSE-C Announcements",
      "23CSE351 FoDS G1"
    ],

    maxScrollAttempts: 30,
    cacheSize: 500,
    scanCompleteAutoHideMs: 7000, // 7 seconds (within 5-10s requirement)
    debug: true
  };

  // ===========================================================================
  // 2. STATE MACHINE & CACHE
  // States: IDLE, SCANNING, COMPLETE, ERROR, PERSONAL_IGNORED, GROUP_NOT_MONITORED, WHATSAPP_UNAVAILABLE
  // ===========================================================================
  const processedMessageIds = new Set();
  const processedMessageHashes = new Set();

  let currentActiveChat = null;
  let currentIsGroup = false;

  const currentScanStats = {
    scanId: 0,
    groupName: null,
    scanStatus: "IDLE", // IDLE, SCANNING, COMPLETE, ERROR, PERSONAL_IGNORED, GROUP_NOT_MONITORED, WHATSAPP_UNAVAILABLE
    scanStartedAt: null,
    scanCompletedAt: null,
    messagesScanned: 0,
    academicMessages: 0, // Rocket counter: messages processed during THIS scan only
    messagesIgnored: 0,
    duplicates: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    errors: 0,
    failedMessageCount: 0,
    errorReason: null,
    lastProcessedTimestamp: null,
    lastScannedTimestamp: null,
    lastProcessedAcademicTimestamp: null
  };

  let scanCompleteTimer = null;
  let isMonitoringActive = false; // true when auto-hide timer elapses after COMPLETE
  let isPopoverOpen = false;

  function log(...args) {
    if (CONFIG.debug) {
      console.log("[AcademicCollector]", ...args);
    }
  }

  function cleanUnicode(str) {
    if (!str || typeof str !== "string") return "";
    return str.replace(/[\u200E\u200F\u200B-\u200D\u202A-\u202E\u2060\uFEFF]/g, "");
  }

  function hashSimple(str) {
    let hash = 0;
    const clean = cleanUnicode(str).trim().toLowerCase().replace(/\s+/g, " ");
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
  // 3. WHATSAPP WEB DOM SELECTORS
  // ===========================================================================
  const SELECTORS = {
    chatTitle: [
      "#main header span[dir='auto'][title]",
      "#main header span[dir='auto']",
      "#main header [role='heading']",
      "header span[title]",
      "header span._ao3e"
    ],
    chatSubtitle: [
      "#main header span[title].x1f66pv5",
      "#main header span._ao3e[title]",
      "#main header span[dir='auto']._amie",
      "#main header div[role='button'] span[dir='auto']",
      "#main header div._amif span",
      "#main header div.x10l6tqk span",
      "header div[role='button'] span[dir='auto']"
    ],
    headerInfoButton: [
      "#main header [role='button'][aria-label*='info' i]",
      "#main header [role='button'][title*='info' i]",
      "#main header div[role='button']",
      "#main header [data-testid='conversation-info-header']"
    ],
    groupIcons: [
      "#main header [data-icon*='group']",
      "#main header [data-testid*='group']",
      "#main header [data-icon='community']",
      "#main header [data-testid='community']",
      "#main header [data-icon*='announcement']",
      "#main header [data-testid*='announcement']",
      "#main header [data-icon*='channel']",
      "#main header [data-testid*='channel']",
      "#main header [aria-label*='group' i]",
      "#main header [aria-label*='community' i]",
      "#main header [aria-label*='announcement' i]",
      "#main header [aria-label*='channel' i]"
    ],
    userIcons: [
      "#main header [data-icon='default-user']",
      "#main header [data-testid='default-user']",
      "#main header [data-icon='avatar-user']"
    ],
    messageContainers: [
      "div[data-id]",
      "div.message-in",
      "div.message-out",
      "div[role='row']"
    ],
    authorHeaders: [
      "#main span[data-testid='author']",
      "#main span[dir='auto']._ahk_",
      "#main span._ahk-",
      "#main span[dir='auto']._al4b"
    ],
    messageText: [
      "span.selectable-text",
      "span._ao3e",
      "div.copyable-text",
      "span[dir='ltr']"
    ],
    copyableText: [
      "div.copyable-text[data-pre-plain-text]",
      "[data-pre-plain-text]"
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
    const headerEl = document.querySelector("#main header") || document.querySelector("header");
    if (!headerEl) return null;

    // 1. Scan candidate title elements in header to see if any match an allowed group
    const candidateElements = headerEl.querySelectorAll("span[dir='auto'][title], [role='heading'], span[title], span._ao3e, span[dir='auto']");
    for (const el of candidateElements) {
      const raw = el.getAttribute("title") || el.textContent || "";
      const cleaned = cleanUnicode(raw).trim();
      if (cleaned) {
        const norm = normalizeGroupName(cleaned);
        const matchedAllowed = CONFIG.allowedGroups.find(g => normalizeGroupName(g) === norm);
        if (matchedAllowed) {
          return matchedAllowed;
        }
      }
    }

    // 2. Fall back to primary selector order
    for (const sel of SELECTORS.chatTitle) {
      try {
        const el = headerEl.querySelector(sel);
        if (el) {
          const title = el.getAttribute("title") || el.textContent;
          const cleaned = cleanUnicode(title).trim();
          if (cleaned.length > 0) {
            return cleaned;
          }
        }
      } catch (_) {}
    }
    return null;
  }

  function isGroupChat(chatName) {
    const mainEl = document.getElementById("main");
    if (!mainEl) return false;

    const currentTitle = chatName || getActiveChatName() || "";
    const norm = normalizeGroupName(currentTitle);

    // =========================================================================
    // TIER 1 — Strong positive group / announcement evidence
    // =========================================================================

    // 1a: Announcement group composer UI ("Only admins can send messages")
    try {
      const footerEl = mainEl.querySelector("footer") || mainEl.querySelector("[data-testid='conversation-footer']");
      const footerText = footerEl ? (footerEl.textContent || "") : "";
      const isReadOnlyComposer =
        /only (?:community )?admins can send messages/i.test(footerText) ||
        /only (?:community )?admins can send messages/i.test(mainEl.textContent || "") ||
        Boolean(mainEl.querySelector("[data-testid*='read-only']")) ||
        Boolean(mainEl.querySelector("[data-testid*='announcement-banner']"));

      if (isReadOnlyComposer) {
        log(`Group detected via announcement composer notice: "Only admins can send messages" in "${currentTitle}"`);
        return true;
      }
    } catch (_) {}

    // 1b: Header conversation info button (aria-label / title)
    for (const sel of SELECTORS.headerInfoButton) {
      try {
        const btn = mainEl.querySelector(sel);
        if (btn) {
          const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || "").toLowerCase();
          if (
            label.includes("group info") ||
            label.includes("community info") ||
            label.includes("group details") ||
            label.includes("community details") ||
            label.includes("announcement") ||
            label.includes("channel")
          ) {
            return true;
          }
        }
      } catch (_) {}
    }

    // 1c: Group, community, or announcement icons
    for (const sel of SELECTORS.groupIcons) {
      try {
        if (mainEl.querySelector(sel)) return true;
      } catch (_) {}
    }

    // 1d: Subtitle group indicators
    for (const sel of SELECTORS.chatSubtitle) {
      try {
        const subEl = mainEl.querySelector(sel);
        if (subEl) {
          const subText = (subEl.getAttribute("title") || subEl.textContent || "").toLowerCase().trim();
          if (subText) {
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
            if (subText.includes(",") && (subText.includes("you") || subText.split(",").length >= 2)) {
              return true;
            }
          }
        }
      } catch (_) {}
    }

    // 1e: Author headers in message bubbles
    for (const sel of SELECTORS.authorHeaders) {
      try {
        const authorEl = mainEl.querySelector(sel);
        if (authorEl && authorEl.textContent?.trim().length > 0) {
          return true;
        }
      } catch (_) {}
    }

    // =========================================================================
    // TIER 2 — Allowed-group-name match
    // If normalized current chat title EXACTLY matches one of the 6 allowed groups:
    // → classify as GROUP.
    // =========================================================================
    const isAllowedGroupTitle = CONFIG.allowedGroups.some(g => normalizeGroupName(g) === norm);
    if (isAllowedGroupTitle) {
      log(`Group detected via allowed group title match: "${currentTitle}"`);
      return true;
    }

    // =========================================================================
    // TIER 3 — Personal-chat evidence
    // Only classify as PERSONAL when there is strong personal evidence
    // =========================================================================
    // Contact info header
    for (const sel of SELECTORS.headerInfoButton) {
      try {
        const btn = mainEl.querySelector(sel);
        if (btn) {
          const label = (btn.getAttribute("aria-label") || btn.getAttribute("title") || "").toLowerCase();
          if (label.includes("contact info") || label.includes("profile info")) {
            return false;
          }
        }
      } catch (_) {}
    }

    // Subtitle personal status
    for (const sel of SELECTORS.chatSubtitle) {
      try {
        const subEl = mainEl.querySelector(sel);
        if (subEl) {
          const subText = (subEl.getAttribute("title") || subEl.textContent || "").toLowerCase().trim();
          if (
            subText === "online" ||
            subText.startsWith("last seen") ||
            subText === "typing..." ||
            subText === "recording audio..."
          ) {
            return false;
          }
        }
      } catch (_) {}
    }

    // User avatar icons
    for (const sel of SELECTORS.userIcons) {
      try {
        if (mainEl.querySelector(sel)) return false;
      } catch (_) {}
    }

    // Default: classify 1-to-1 personal chat as false
    return false;
  }

  function normalizeGroupName(name) {
    if (!name || typeof name !== "string") return "";
    return cleanUnicode(name)
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function getCanonicalGroupName(name) {
    if (!name) return "";
    const norm = normalizeGroupName(name);
    return CONFIG.allowedGroups.find(g => normalizeGroupName(g) === norm) || cleanUnicode(name).trim();
  }

  function isGroupMonitored(chatName) {
    if (!currentIsGroup) return false;
    if (!chatName) return false;
    const norm = normalizeGroupName(chatName);
    const list = CONFIG.allowedGroups || [];
    return list.some(g => normalizeGroupName(g) === norm);
  }

  // ===========================================================================
  // 4. TIMESTAMP PARSER & BOUNDARY CHECKS
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

  function formatDisplayDate(isoStr) {
    if (!isoStr) return "Never";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const day = d.getDate();
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = d.getMinutes();
      const meridian = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      const padMin = minutes < 10 ? `0${minutes}` : minutes;
      return `${day} ${month} ${year} ${hours}:${padMin} ${meridian}`;
    } catch (_) {
      return isoStr;
    }
  }

  // ===========================================================================
  // 5. MESSAGE EXTRACTION & RELEVANCE FILTER
  // ===========================================================================
  function extractMessageDetails(msgNode) {
    try {
      let text = "";
      for (const sel of SELECTORS.messageText) {
        try {
          const el = msgNode.querySelector(sel);
          if (el) {
            const t = el.innerText || el.textContent || "";
            if (t && cleanUnicode(t).trim().length > 0) {
              text = cleanUnicode(t).trim();
              break;
            }
          }
        } catch (_) {}
      }

      if (!text) {
        const copyable = msgNode.querySelector("div.copyable-text");
        if (copyable) {
          const t = copyable.innerText || copyable.textContent || "";
          if (t && cleanUnicode(t).trim().length > 0) {
            text = cleanUnicode(t).trim();
          }
        }
      }

      if (!text) {
        const spans = msgNode.querySelectorAll("span[dir='ltr'], span[dir='auto']");
        for (const s of spans) {
          if (s.matches?.("[data-testid='msg-time'], [data-testid='msg-meta'] span, time")) continue;
          const st = cleanUnicode(s.innerText || s.textContent || "").trim();
          if (st.length > 2 && !/^\d{1,2}:\d{2}(?:\s*(?:am|pm))?$/i.test(st)) {
            text = st;
            break;
          }
        }
      }

      if (!text) {
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
            sender = cleanUnicode(match[3]?.trim());
          }
        }
      }

      if (!sender) {
        const authorEl = queryFirst(msgNode, SELECTORS.authorHeaders);
        if (authorEl) {
          sender = cleanUnicode(authorEl.textContent?.trim() || "");
        }
      }

      if (!timestamp) {
        const timeEl = msgNode.querySelector("[data-testid='msg-time'], time, span._aau4");
        if (timeEl) {
          const timeText = timeEl.textContent?.trim();
          if (timeText) {
            timestamp = parseWhatsAppMessageTimestamp(timeText);
          }
        }
      }

      return {
        id: dataId,
        text,
        sender: sender || undefined,
        timestamp: timestamp || new Date().toISOString()
      };
    } catch (err) {
      log("Error extracting message details:", err);
      return null;
    }
  }

  const STRICT_ACADEMIC_KEYWORDS = [
    "assignment", "submit", "submission", "deadline", "due", "exam", "examination",
    "internal", "end semester", "end-sem", "slip test", "quiz", "lab", "practical",
    "viva", "project", "presentation", "seminar", "course", "certification",
    "assessment", "test", "scheduled", "postponed", "cancelled", "canceled",
    "rescheduled", "extended", "submission link", "classroom.google.com",
    "forms.gle", "moodle", "drive.google.com", "hall ticket", "syllabus",
    "fods", "data science", "announcement", "announcements", "notice", "circular",
    "schedule", "timetable", "time table", "class", "classes", "lecture",
    "lectures", "session", "sessions", "tutorial", "workshop", "webinar",
    "holiday", "mid term", "mid-term", "midterm", "mid sem", "mid-sem",
    "midsem", "hall", "room", "faculty", "hod", "coordinator", "cse", "toc", "nlp", "cn"
  ];

  const PROMOTIONAL_INDICATORS = [
    /\b(0%\s*(?:interest|emi)|zero\s*%?\s*interest)\b/i,
    /\b(?:emi|down\s*payment|monthly\s*installments?)\b/i,
    /\b(?:plots?\s+for\s+sale|villas?\s+for\s+sale|flats?\s+for\s+sale|apartments?\s+for\s+sale)\b/i,
    /\b(?:real\s*estate|gated\s*community|open\s*plots?|acres?\s+of\s+land)\b/i,
    /\b(?:your\s+land\b.*?\byour\s+legacy\b|commercial\s+space\s+for\s+sale)\b/i,
    /\b(?:exclusive\s*offer|limited\s*period\s*offer|special\s*discount|discount\s*\d+%)\b/i,
    /\b(?:enquire\s*(?:now|today)|contact\s*us|call\s*us\s+at|visit\s*our\s*(?:site|store|office))\b/i,
    /\b(?:book\s*your\s*(?:site\s*visit|flat|plot|slot))\b/i,
    /\b(?:cashback|coupon\s*code|invest\s*now|guaranteed\s*returns?)\b/i
  ];

  const ATTENDANCE_ONLY_PATTERNS = [
    /\battendance\s+(?:will\s+be\s+taken|percentage|shortage|today|update|list|shortage\s+list|rules?|criteria)\b/i,
    /\bstudents?\s+with\s+low\s+attendance\b/i,
    /\b(?:mark|record)\s+your\s+attendance\b/i,
    /\btoday'?s?\s+attendance\s+is\s+\d+%\b/i,
    /\battendance\s+shortage\b/i,
    /\battendance\s+is\s+mandatory\b/i
  ];

  const CLEAR_CHATTER_EXACT = new Set([
    "hi", "hello", "hey", "ok", "k", "okay", "thanks", "thank you", "thx",
    "good morning", "gm", "good afternoon", "good evening", "good night", "gn",
    "happy birthday", "hbd", "congrats", "congratulations", "yes", "no", "fine",
    "cool", "lol", "lmao", "done", "noted", "+1", "👍", "👌", "🙏", "😂", "❤️", "🎉"
  ]);

  function passesLocalFilter(text, groupName = "") {
    const clean = cleanUnicode(text).trim();
    const lower = clean.toLowerCase();

    if (CLEAR_CHATTER_EXACT.has(lower)) return false;

    const emojiOrSymbolOnly = /^[\p{Emoji}\s\d\W]+$/u.test(clean) && !/[a-zA-Z]{3,}/.test(clean);
    if (emojiOrSymbolOnly) return false;

    const isPromo = PROMOTIONAL_INDICATORS.some(pat => pat.test(clean));
    if (isPromo) return false;

    // Announcement channel pass-through: In channels like "CSE-C Announcements",
    // broadcasts sent by faculty/admins are legitimate academic announcements.
    const isAnnouncementChannel = /announcement/i.test(groupName);
    if (isAnnouncementChannel) {
      const isPureAttendance = ATTENDANCE_ONLY_PATTERNS.some(pat => pat.test(clean)) &&
        !/\b(assignment\d*|submit|deadline|due|exam|slip\s*test|quiz|lab|project|presentation|test|class|schedule|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(clean);
      if (isPureAttendance) return false;
      return /[a-zA-Z]{3,}/.test(clean);
    }

    const hasAcademicSignal = STRICT_ACADEMIC_KEYWORDS.some(kw => lower.includes(kw));

    const isAttendance = ATTENDANCE_ONLY_PATTERNS.some(pat => pat.test(clean));
    if (isAttendance) {
      const hasRealAcademicEvent = /\b(assignment\d*|submit|deadline|due|exam|slip\s*test|quiz|lab|project|presentation|test|class|lecture)\b/i.test(clean);
      if (!hasRealAcademicEvent) return false;
    }

    const hasUrl = /https?:\/\/[^\s]+/i.test(clean);
    if (hasUrl && !hasAcademicSignal) return false;

    const hasCourseCode = /\b[0-9]{2}[A-Z]{3}[0-9]{3}\b/i.test(clean) || /\b[A-Z]{2,4}[0-9]{3}\b/i.test(clean);

    return hasAcademicSignal || hasCourseCode;
  }

  // ===========================================================================
  // 6. BACKEND API CLIENT
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
        timeout: 20000,
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
        onerror: err => {
          setCollectorState("WHATSAPP_UNAVAILABLE");
          reject(err);
        },
        ontimeout: () => {
          setCollectorState("WHATSAPP_UNAVAILABLE");
          reject(new Error("Request timed out"));
        }
      });
    });
  }

  async function reportCollectorStatus(payload) {
    try {
      if (payload && payload.currentGroup) {
        payload.currentGroup = getCanonicalGroupName(payload.currentGroup);
      }
      await apiRequest("POST", "/api/collector/status", payload);
    } catch (err) {
      log("Error reporting collector status:", err.message);
    }
  }

  async function fetchGroupState(groupName) {
    try {
      const canonical = getCanonicalGroupName(groupName);
      const res = await apiRequest("GET", `/api/collector/groups/${encodeURIComponent(canonical)}`);
      return res.data?.group || null;
    } catch (_) {
      return null;
    }
  }

  async function updateGroupCursor(groupName, updates) {
    try {
      const canonical = getCanonicalGroupName(groupName);
      if (updates && updates.groupName) updates.groupName = canonical;
      const res = await apiRequest("PATCH", `/api/collector/groups/${encodeURIComponent(canonical)}/cursor`, updates);
      return res.data?.group || null;
    } catch (err) {
      log("Failed to update group cursor:", err.message);
      return null;
    }
  }

  async function sendAcademicMessage(payload) {
    if (payload && payload.sourceGroup) {
      payload.sourceGroup = getCanonicalGroupName(payload.sourceGroup);
    }
    return await apiRequest("POST", "/api/collector/messages", payload);
  }

  // ===========================================================================
  // 7. VIRTUAL SCROLLING ENGINE (September 10 Backfill)
  // ===========================================================================
  function findMessageScrollContainer() {
    const mainEl = document.getElementById("main");
    if (!mainEl) return null;

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

    let nodes = [];
    for (const sel of SELECTORS.messageContainers) {
      const found = mainEl.querySelectorAll(sel);
      if (found && found.length > 0) {
        const candidateNodes = [];
        found.forEach(n => {
          const details = extractMessageDetails(n);
          if (details && details.text) {
            candidateNodes.push(details);
          }
        });
        if (candidateNodes.length > 0) {
          nodes = candidateNodes;
          break;
        }
      }
    }

    return nodes.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  async function scrollUpToBackfillBoundary() {
    const container = findMessageScrollContainer();
    if (!container) return;

    log("Virtual scrolling upward for September 10 boundary...");
    let attempts = 0;

    while (attempts < CONFIG.maxScrollAttempts) {
      attempts++;
      const currentMessages = getRenderedMessages();
      if (currentMessages.length > 0) {
        const earliest = currentMessages[0];
        if (!isEligibleDate(earliest.timestamp)) {
          log("Reached September 10 backfill boundary! Earliest message:", earliest.timestamp);
          break;
        }
      }

      const prevScrollHeight = container.scrollHeight;
      container.scrollTop = 0;
      await delay(700);

      if (container.scrollHeight === prevScrollHeight && attempts > 3) {
        log("Reached top of available chat history in WhatsApp Web.");
        break;
      }
    }
  }

  // ===========================================================================
  // 8. STATE MACHINE CONTROLLER & BADGE UPDATE
  // ===========================================================================
  function setCollectorState(newState, groupName = null, extra = {}) {
    if (scanCompleteTimer) {
      clearTimeout(scanCompleteTimer);
      scanCompleteTimer = null;
    }

    currentScanStats.scanStatus = newState;
    if (groupName !== null) currentScanStats.groupName = groupName;
    if (extra.errorReason !== undefined) currentScanStats.errorReason = extra.errorReason;
    if (extra.failedMessageCount !== undefined) currentScanStats.failedMessageCount = extra.failedMessageCount;
    if (extra.lastProcessedTimestamp !== undefined) currentScanStats.lastProcessedTimestamp = extra.lastProcessedTimestamp;

    if (newState === "COMPLETE") {
      isMonitoringActive = false;
      // Keep Scan Complete visible for 7s before auto-hiding to monitoring pill
      scanCompleteTimer = setTimeout(() => {
        if (currentScanStats.scanStatus === "COMPLETE" && !isPopoverOpen) {
          isMonitoringActive = true;
          updateStatusBadge();
        }
      }, CONFIG.scanCompleteAutoHideMs);
    } else {
      isMonitoringActive = false;
    }

    updateStatusBadge();
  }

  // ===========================================================================
  // 9. MANUAL PER-GROUP SCAN EXECUTION ENGINE
  // ===========================================================================
  async function runManualGroupScan(groupName, scanId) {
    if (currentScanStats.scanId !== scanId) return;

    log(`Beginning manual group scan for: "${groupName}" (Scan ID: ${scanId})`);

    const norm = normalizeGroupName(groupName);
    const isAllowed = CONFIG.allowedGroups.some(g => normalizeGroupName(g) === norm);
    if (!isAllowed) {
      setCollectorState("GROUP_NOT_MONITORED", groupName);
      return;
    }

    if (!isGroupChat(groupName)) {
      setCollectorState("PERSONAL_IGNORED", groupName);
      return;
    }

    setCollectorState("SCANNING", groupName);
    currentScanStats.scanStartedAt = new Date().toISOString();
    currentScanStats.scanCompletedAt = null;

    await reportCollectorStatus({
      currentGroup: groupName,
      chatType: "GROUP",
      collectionStatus: "ACTIVE",
      scanStatus: "SCANNING",
      scanStartedAt: currentScanStats.scanStartedAt,
      scanCompletedAt: null,
      messagesScanned: 0,
      academicMessages: 0,
      messagesIgnored: 0,
      duplicates: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      errors: 0,
      lastProcessedTimestamp: null,
      whatsappAvailable: true
    });

    if (currentScanStats.scanId !== scanId) return;

    // Fetch persistent group state from server
    const groupState = await fetchGroupState(groupName);
    if (currentScanStats.scanId !== scanId) return;

    const isBackfill = !groupState || !groupState.backfillComplete;
    if (isBackfill) {
      log(`Group "${groupName}" requires initial backfill. Scrolling to September 10...`);
      await scrollUpToBackfillBoundary();
      if (currentScanStats.scanId !== scanId) return;
    } else {
      log(`Group "${groupName}" already backfilled. Resuming from scan cursor:`, groupState.lastScannedMessageTimestamp || groupState.lastProcessedMessageTimestamp);
    }

    const renderedMessages = getRenderedMessages();
    currentScanStats.messagesScanned = renderedMessages.length;

    const scanCursor = groupState?.lastScannedMessageTimestamp || groupState?.lastProcessedMessageTimestamp || null;
    let newestScannedTimestamp = scanCursor;
    let newestScannedId = groupState?.lastScannedMessageId || groupState?.lastProcessedMessageId || null;
    let newestProcessedAcademicTimestamp = groupState?.lastProcessedAcademicMessageTimestamp || groupState?.lastProcessedMessageTimestamp || null;
    let newestProcessedAcademicId = groupState?.lastProcessedAcademicMessageId || groupState?.lastProcessedMessageId || null;

    currentScanStats.lastProcessedTimestamp = newestProcessedAcademicTimestamp || newestScannedTimestamp;
    currentScanStats.lastScannedTimestamp = newestScannedTimestamp;
    currentScanStats.lastProcessedAcademicTimestamp = newestProcessedAcademicTimestamp;
    updateStatusBadge();

    let scanError = null;

    for (const msg of renderedMessages) {
      if (currentScanStats.scanId !== scanId) {
        log(`Scan ${scanId} aborted due to group switch.`);
        return;
      }

      // September 10 boundary check
      if (!isEligibleDate(msg.timestamp)) {
        currentScanStats.messagesIgnored++;
        updateStatusBadge();
        continue;
      }

      // Cursor check: skip already scanned messages from previous scans
      if (scanCursor && !isNewerThanCursor(msg.timestamp, scanCursor)) {
        continue;
      }

      // Deduplication check
      if (isDuplicate(msg.id, msg.text)) {
        currentScanStats.duplicates++;
        newestScannedTimestamp = msg.timestamp;
        if (msg.id) newestScannedId = msg.id;
        currentScanStats.lastScannedTimestamp = msg.timestamp;
        currentScanStats.lastProcessedTimestamp = newestProcessedAcademicTimestamp || newestScannedTimestamp;
        updateStatusBadge();
        continue;
      }

      markAsProcessed(msg.id, msg.text);

      // Local relevance filter (chatter, attendance-only, advertisements)
      if (!passesLocalFilter(msg.text, groupName)) {
        currentScanStats.messagesIgnored++;
        // Ignored messages advance the scan cursor
        newestScannedTimestamp = msg.timestamp;
        if (msg.id) newestScannedId = msg.id;
        currentScanStats.lastScannedTimestamp = msg.timestamp;
        currentScanStats.lastProcessedTimestamp = newestProcessedAcademicTimestamp || newestScannedTimestamp;
        updateStatusBadge();
        continue;
      }

      // Send to backend (Gemini -> Supabase -> Notion sync)
      try {
        const res = await sendAcademicMessage({
          message: msg.text,
          sourceGroup: groupName,
          sourceSender: msg.sender,
          messageTimestamp: msg.timestamp,
          sourceMessageId: msg.id || undefined
        });

        // Examination succeeded - advance scan cursor
        newestScannedTimestamp = msg.timestamp;
        if (msg.id) newestScannedId = msg.id;
        currentScanStats.lastScannedTimestamp = msg.timestamp;

        const action = res?.data?.action;
        if (action === "CREATED" || action === "UPDATED") {
          currentScanStats.academicMessages++;
          newestProcessedAcademicTimestamp = msg.timestamp;
          if (msg.id) newestProcessedAcademicId = msg.id;
          currentScanStats.lastProcessedAcademicTimestamp = msg.timestamp;
          currentScanStats.lastProcessedTimestamp = msg.timestamp;

          if (action === "CREATED") {
            currentScanStats.eventsCreated++;
          } else {
            currentScanStats.eventsUpdated++;
          }
        } else if (action === "IGNORED_DUPLICATE") {
          currentScanStats.duplicates++;
        } else if (action === "NON_ACADEMIC") {
          currentScanStats.messagesIgnored++;
        }

        currentScanStats.lastProcessedTimestamp = newestProcessedAcademicTimestamp || newestScannedTimestamp;
        updateStatusBadge();

        await reportCollectorStatus({
          currentGroup: groupName,
          chatType: "GROUP",
          collectionStatus: "ACTIVE",
          scanStatus: "SCANNING",
          scanStartedAt: currentScanStats.scanStartedAt,
          scanCompletedAt: null,
          messagesScanned: currentScanStats.messagesScanned,
          academicMessages: currentScanStats.academicMessages,
          messagesIgnored: currentScanStats.messagesIgnored,
          duplicates: currentScanStats.duplicates,
          eventsCreated: currentScanStats.eventsCreated,
          eventsUpdated: currentScanStats.eventsUpdated,
          errors: currentScanStats.errors,
          lastProcessedTimestamp: currentScanStats.lastProcessedTimestamp,
          whatsappAvailable: true
        });
      } catch (err) {
        log(`Failed processing message in "${groupName}":`, err.message);
        currentScanStats.errors++;
        currentScanStats.failedMessageCount++;
        currentScanStats.errorReason = err.message || "Failed processing message";
        scanError = err;
        // DO NOT advance cursor past failed message!
        break;
      }
    }

    if (currentScanStats.scanId !== scanId) return;

    if (scanError) {
      setCollectorState("ERROR", groupName, {
        errorReason: currentScanStats.errorReason,
        failedMessageCount: currentScanStats.failedMessageCount,
        lastProcessedTimestamp: newestProcessedAcademicTimestamp || newestScannedTimestamp
      });

      // Update cursor with error, not past failed message
      await updateGroupCursor(groupName, {
        groupName,
        lastScannedMessageTimestamp: newestScannedTimestamp,
        lastScannedMessageId: newestScannedId,
        lastProcessedAcademicMessageTimestamp: newestProcessedAcademicTimestamp,
        lastProcessedAcademicMessageId: newestProcessedAcademicId,
        lastProcessedMessageTimestamp: newestProcessedAcademicTimestamp || newestScannedTimestamp,
        lastProcessedMessageId: newestProcessedAcademicId || newestScannedId,
        backfillComplete: groupState?.backfillComplete || false,
        status: "ERROR",
        lastError: currentScanStats.errorReason,
        messagesScannedIncrement: currentScanStats.messagesScanned,
        messagesProcessedIncrement: currentScanStats.academicMessages,
        messagesIgnoredIncrement: currentScanStats.messagesIgnored,
        messagesFailedIncrement: currentScanStats.failedMessageCount
      });

      await reportCollectorStatus({
        currentGroup: groupName,
        chatType: "GROUP",
        collectionStatus: "ACTIVE",
        scanStatus: "ERROR",
        scanStartedAt: currentScanStats.scanStartedAt,
        scanCompletedAt: null,
        messagesScanned: currentScanStats.messagesScanned,
        academicMessages: currentScanStats.academicMessages,
        messagesIgnored: currentScanStats.messagesIgnored,
        duplicates: currentScanStats.duplicates,
        eventsCreated: currentScanStats.eventsCreated,
        eventsUpdated: currentScanStats.eventsUpdated,
        errors: currentScanStats.errors,
        lastProcessedTimestamp: currentScanStats.lastProcessedTimestamp,
        lastError: currentScanStats.errorReason,
        whatsappAvailable: true
      });
      return;
    }

    // Safely update cursor AFTER all processing finishes
    await updateGroupCursor(groupName, {
      groupName,
      lastScannedMessageTimestamp: newestScannedTimestamp,
      lastScannedMessageId: newestScannedId,
      lastProcessedAcademicMessageTimestamp: newestProcessedAcademicTimestamp,
      lastProcessedAcademicMessageId: newestProcessedAcademicId,
      lastProcessedMessageTimestamp: newestProcessedAcademicTimestamp || newestScannedTimestamp,
      lastProcessedMessageId: newestProcessedAcademicId || newestScannedId,
      backfillComplete: true,
      status: "MONITORING",
      lastError: null,
      messagesScannedIncrement: currentScanStats.messagesScanned,
      messagesProcessedIncrement: currentScanStats.academicMessages,
      messagesIgnoredIncrement: currentScanStats.messagesIgnored,
      messagesFailedIncrement: 0
    });

    if (currentScanStats.scanId !== scanId) return;

    // Transition to COMPLETE state
    currentScanStats.scanCompletedAt = new Date().toISOString();
    setCollectorState("COMPLETE", groupName);

    log(`=== SCAN COMPLETE FOR "${groupName}" ===`);

    await reportCollectorStatus({
      currentGroup: groupName,
      chatType: "GROUP",
      collectionStatus: "ACTIVE",
      scanStatus: "COMPLETE",
      scanStartedAt: currentScanStats.scanStartedAt,
      scanCompletedAt: currentScanStats.scanCompletedAt,
      messagesScanned: currentScanStats.messagesScanned,
      academicMessages: currentScanStats.academicMessages,
      messagesIgnored: currentScanStats.messagesIgnored,
      duplicates: currentScanStats.duplicates,
      eventsCreated: currentScanStats.eventsCreated,
      eventsUpdated: currentScanStats.eventsUpdated,
      errors: 0,
      lastProcessedTimestamp: currentScanStats.lastProcessedTimestamp,
      lastError: null,
      whatsappAvailable: true
    });
  }

  // ===========================================================================
  // 10. CHAT SWITCHING & MUTATION OBSERVER
  // ===========================================================================
  let observer = null;

  function handleChatSwitch() {
    const pane = document.getElementById("pane-side");
    if (!pane) {
      if (currentScanStats.scanStatus !== "WHATSAPP_UNAVAILABLE") {
        setCollectorState("WHATSAPP_UNAVAILABLE");
      }
      return;
    }

    const activeChat = getActiveChatName();
    if (!activeChat) {
      if (currentActiveChat !== null) {
        currentActiveChat = null;
        currentIsGroup = false;
        currentScanStats.scanId++;
        setCollectorState("IDLE");
        reportCollectorStatus({
          currentGroup: null,
          chatType: null,
          collectionStatus: "PAUSED",
          scanStatus: "IDLE",
          whatsappAvailable: true
        });
      }
      return;
    }

    const isGroup = isGroupChat(activeChat);
    const chatChanged = activeChat !== currentActiveChat || isGroup !== currentIsGroup;

    if (chatChanged) {
      currentActiveChat = activeChat;
      currentIsGroup = isGroup;

      log("Chat switched to:", activeChat, "Type:", isGroup ? "GROUP" : "PERSONAL");

      const norm = normalizeGroupName(activeChat);
      const isAllowed = isGroup && CONFIG.allowedGroups.some(g => normalizeGroupName(g) === norm);

      // Increment scanId to cancel any active scan from previous chat
      currentScanStats.scanId++;
      const thisScanId = currentScanStats.scanId;

      if (!isGroup) {
        setCollectorState("PERSONAL_IGNORED", activeChat);
        reportCollectorStatus({
          currentGroup: activeChat,
          chatType: "PERSONAL",
          collectionStatus: "IGNORED",
          scanStatus: "PERSONAL_IGNORED",
          whatsappAvailable: true
        });
        return;
      }

      if (!isAllowed) {
        setCollectorState("GROUP_NOT_MONITORED", activeChat);
        reportCollectorStatus({
          currentGroup: activeChat,
          chatType: "GROUP",
          collectionStatus: "IGNORED",
          scanStatus: "GROUP_NOT_MONITORED",
          whatsappAvailable: true
        });
        return;
      }

      // Allowed group opened! Reset state machine for this group and begin scan
      currentScanStats.groupName = activeChat;
      currentScanStats.scanStartedAt = new Date().toISOString();
      currentScanStats.scanCompletedAt = null;
      currentScanStats.messagesScanned = 0;
      currentScanStats.academicMessages = 0;
      currentScanStats.messagesIgnored = 0;
      currentScanStats.duplicates = 0;
      currentScanStats.eventsCreated = 0;
      currentScanStats.eventsUpdated = 0;
      currentScanStats.errors = 0;
      currentScanStats.failedMessageCount = 0;
      currentScanStats.errorReason = null;
      currentScanStats.lastProcessedTimestamp = null;

      setCollectorState("SCANNING", activeChat);
      runManualGroupScan(activeChat, thisScanId);
    }
  }

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(mutations => {
      handleChatSwitch();

      // If actively scanning, sequential loop handles messages
      if (currentScanStats.scanStatus === "SCANNING") return;

      // Only handle live incoming messages for allowed groups
      if (!currentIsGroup || !isGroupMonitored(currentActiveChat)) return;

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
                currentScanStats.messagesScanned++;

                if (!passesLocalFilter(details.text, currentActiveChat)) {
                  currentScanStats.messagesIgnored++;
                  currentScanStats.lastProcessedTimestamp = details.timestamp;
                  updateStatusBadge();
                  continue;
                }

                sendAcademicMessage({
                  message: details.text,
                  sourceGroup: currentActiveChat,
                  sourceSender: details.sender,
                  messageTimestamp: details.timestamp,
                  sourceMessageId: details.id || undefined
                }).then(res => {
                  currentScanStats.academicMessages++;
                  currentScanStats.lastProcessedTimestamp = details.timestamp;
                  if (res?.data?.action === "CREATED") currentScanStats.eventsCreated++;
                  else if (res?.data?.action === "UPDATED") currentScanStats.eventsUpdated++;
                  updateStatusBadge();

                  updateGroupCursor(currentActiveChat, {
                    groupName: currentActiveChat,
                    lastScannedMessageTimestamp: details.timestamp,
                    lastScannedMessageId: details.id || null,
                    lastProcessedAcademicMessageTimestamp: details.timestamp,
                    lastProcessedAcademicMessageId: details.id || null,
                    lastProcessedMessageTimestamp: details.timestamp,
                    lastProcessedMessageId: details.id || null,
                    backfillComplete: true,
                    status: "MONITORING",
                    messagesScannedIncrement: 1,
                    messagesProcessedIncrement: 1,
                    messagesIgnoredIncrement: 0
                  });
                }).catch(err => {
                  currentScanStats.errors++;
                  currentScanStats.failedMessageCount++;
                  currentScanStats.errorReason = err.message || "Failed processing message";
                  setCollectorState("ERROR", currentActiveChat, { errorReason: err.message, failedMessageCount: 1 });
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
  // 11. FLOATING STATUS BADGE UX (BOTTOM-LEFT PILL & POPOVER)
  // Position: Bottom-Left of WhatsApp Web
  // Style: Small, compact, unobtrusive floating pill with attached tooltip popover
  // ===========================================================================
  let containerEl = null;
  let pillEl = null;
  let popoverEl = null;

  function createStatusBadge() {
    if (containerEl) return;

    containerEl = document.createElement("div");
    containerEl.id = "acc-collector-container";
    containerEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      user-select: none;
    `;

    // Tooltip Popover (appears above pill when clicked or hovered)
    popoverEl = document.createElement("div");
    popoverEl.id = "acc-collector-popover";
    popoverEl.style.cssText = `
      position: absolute;
      bottom: calc(100% + 8px);
      left: 0;
      min-width: 240px;
      max-width: 300px;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 10px 14px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      font-size: 11px;
      line-height: 1.5;
      display: none;
      pointer-events: auto;
    `;

    // Main Floating Pill
    pillEl = document.createElement("div");
    pillEl.id = "acc-collector-pill";
    pillEl.style.cssText = `
      background: #0f172a;
      color: #f8fafc;
      font-size: 11px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 20px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      border: 1px solid #334155;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s ease;
      max-width: 440px;
    `;

    // Toggle popover on pill click
    pillEl.addEventListener("click", e => {
      e.stopPropagation();
      isPopoverOpen = !isPopoverOpen;
      popoverEl.style.display = isPopoverOpen ? "block" : "none";
      updateStatusBadge();
    });

    // Close popover when clicking anywhere outside
    document.addEventListener("click", () => {
      if (isPopoverOpen) {
        isPopoverOpen = false;
        popoverEl.style.display = "none";
        updateStatusBadge();
      }
    });

    // Keep popover visible on hover
    containerEl.addEventListener("mouseenter", () => {
      popoverEl.style.display = "block";
    });

    containerEl.addEventListener("mouseleave", () => {
      if (!isPopoverOpen) {
        popoverEl.style.display = "none";
      }
    });

    containerEl.appendChild(popoverEl);
    containerEl.appendChild(pillEl);
    document.body.appendChild(containerEl);

    updateStatusBadge();
  }

  function getBadgeMainText() {
    const group = currentScanStats.groupName || currentActiveChat || "";
    const status = currentScanStats.scanStatus;
    const count = currentScanStats.academicMessages;

    switch (status) {
      case "SCANNING":
        return count > 0
          ? `🟡 ACC Collector: Scanning · ${group} · ${count}`
          : `🟡 ACC Collector: Scanning · ${group}`;

      case "COMPLETE":
        if (isMonitoringActive) {
          return `🟢 ACC Collector: Monitoring · ${group}`;
        }
        return count > 0
          ? `🟢 ACC Collector: Scan Complete · ${group} · ${count} processed`
          : `🟢 ACC Collector: Scan Complete · ${group}`;

      case "ERROR":
        return `🔴 ACC Collector: Scan Error · ${group}`;

      case "PERSONAL_IGNORED":
        return `⚪ ACC Collector: Personal Chat Ignored`;

      case "GROUP_NOT_MONITORED":
        return `⚪ ACC Collector: Group Not Monitored`;

      case "WHATSAPP_UNAVAILABLE":
        return `🔴 ACC Collector: WhatsApp Unavailable`;

      case "IDLE":
      default:
        return `⚪ ACC Collector: Idle`;
    }
  }

  function renderPopoverContent() {
    const group = currentScanStats.groupName || currentActiveChat || "None";
    const status = currentScanStats.scanStatus;
    const formattedLastProcessed = formatDisplayDate(currentScanStats.lastProcessedTimestamp);

    if (status === "COMPLETE" || (status === "SCANNING" && isMonitoringActive)) {
      return `
        <div style="font-weight:700;font-size:12px;color:#22c55e;margin-bottom:6px">Group: ${group}</div>
        <div style="display:grid;gap:3px;color:#cbd5e1">
          <div><strong>Status:</strong> COMPLETE</div>
          <div><strong>Messages processed:</strong> ${currentScanStats.academicMessages}</div>
          <div><strong>Academic messages:</strong> ${currentScanStats.academicMessages}</div>
          <div><strong>Ignored:</strong> ${currentScanStats.messagesIgnored}</div>
          <div><strong>Duplicates:</strong> ${currentScanStats.duplicates}</div>
          <div><strong>Events created:</strong> +${currentScanStats.eventsCreated}</div>
          <div><strong>Events updated:</strong> ~${currentScanStats.eventsUpdated}</div>
          <div style="margin-top:4px;padding-top:4px;border-top:1px solid #334155;color:#94a3b8">
            <strong>Last processed:</strong><br><span style="color:#f8fafc">${formattedLastProcessed}</span>
          </div>
          <div style="color:#22c55e;margin-top:2px"><strong>Cursor:</strong> Saved</div>
        </div>
      `;
    }

    if (status === "ERROR") {
      return `
        <div style="font-weight:700;font-size:12px;color:#ef4444;margin-bottom:6px">Group: ${group}</div>
        <div style="display:grid;gap:3px;color:#cbd5e1">
          <div><strong>Status:</strong> ERROR</div>
          <div><strong>Messages scanned:</strong> ${currentScanStats.messagesScanned}</div>
          <div><strong>Messages processed:</strong> ${currentScanStats.academicMessages}</div>
          <div><strong>Messages failed:</strong> ${currentScanStats.failedMessageCount}</div>
          <div style="margin-top:4px;padding-top:4px;border-top:1px solid #334155;color:#94a3b8">
            <strong>Last successful message:</strong><br><span style="color:#f8fafc">${formattedLastProcessed}</span>
          </div>
          <div style="color:#f87171;margin-top:2px;word-break:break-word">
            <strong>Error reason:</strong><br>${currentScanStats.errorReason || "Processing failed"}
          </div>
          <div style="color:#eab308;margin-top:2px"><strong>Cursor:</strong> Held at last successful message</div>
        </div>
      `;
    }

    if (status === "SCANNING") {
      return `
        <div style="font-weight:700;font-size:12px;color:#eab308;margin-bottom:6px">Group: ${group}</div>
        <div style="display:grid;gap:3px;color:#cbd5e1">
          <div><strong>Status:</strong> SCANNING</div>
          <div><strong>Messages scanned:</strong> ${currentScanStats.messagesScanned}</div>
          <div><strong>Academic processed:</strong> ${currentScanStats.academicMessages}</div>
          <div><strong>Ignored:</strong> ${currentScanStats.messagesIgnored}</div>
          <div><strong>Duplicates:</strong> ${currentScanStats.duplicates}</div>
          <div><strong>Created:</strong> +${currentScanStats.eventsCreated}</div>
          <div><strong>Updated:</strong> ~${currentScanStats.eventsUpdated}</div>
          <div style="color:#38bdf8;margin-top:4px;font-size:10px">Processing in progress...</div>
        </div>
      `;
    }

    if (status === "PERSONAL_IGNORED") {
      return `
        <div style="font-weight:700;font-size:12px;color:#94a3b8;margin-bottom:4px">Personal Chat: ${group}</div>
        <div style="color:#94a3b8">1-to-1 personal chats are strictly ignored for privacy. No messages or cursors are collected.</div>
      `;
    }

    if (status === "GROUP_NOT_MONITORED") {
      return `
        <div style="font-weight:700;font-size:12px;color:#94a3b8;margin-bottom:4px">Group: ${group}</div>
        <div style="color:#94a3b8">This group is not in the configured academic allowlist. Message collection and Gemini parsing are disabled.</div>
      `;
    }

    if (status === "WHATSAPP_UNAVAILABLE") {
      return `
        <div style="font-weight:700;font-size:12px;color:#ef4444;margin-bottom:4px">WhatsApp Unavailable</div>
        <div style="color:#f87171">Backend server unreachable or WhatsApp Web disconnected. Please ensure localhost:3000 is running.</div>
      `;
    }

    return `
      <div style="font-weight:700;font-size:12px;color:#94a3b8;margin-bottom:4px">ACC Collector: Idle</div>
      <div style="color:#94a3b8">Open one of the 6 monitored academic groups to trigger scanning.</div>
    `;
  }

  function updateStatusBadge() {
    if (!pillEl) return;

    const mainText = getBadgeMainText();

    // Rocket counter strictly shows messages processed during THIS scan
    const rocketHtml = `
      <span style="background:#1e293b;border:1px solid #334155;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;color:#38bdf8;margin-left:auto" title="Messages processed during current scan">
        🚀 ${currentScanStats.academicMessages}
      </span>
    `;

    pillEl.innerHTML = `
      <span>${mainText}</span>
      ${rocketHtml}
    `;

    if (popoverEl) {
      popoverEl.innerHTML = renderPopoverContent();
    }
  }

  // ===========================================================================
  // 12. INITIALIZATION
  // ===========================================================================
  function init() {
    log("Initializing Academic Command Center Collector v3.2 (Bottom-Left Floating Badge UX)...");
    createStatusBadge();

    // Check periodically for chat header changes
    setInterval(() => {
      handleChatSwitch();
    }, 1000);

    // Start live DOM observer
    startObserver();

    // Check active chat immediately
    setTimeout(() => {
      handleChatSwitch();
    }, 1000);
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
