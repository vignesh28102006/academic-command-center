import { AcademicItem, AcademicType } from "./types";
import { extractDateString, extractMultipleDates, extractTimeString, toLocalDateString } from "./dateUtils";
import { isPromotionalMessage, isPureAttendanceMessage } from "./collector/relevanceFilter";

const URL_REGEX = /https?:\/\/[^\s)\]]+/gi;

const COMMON_SUBJECTS: { pattern: RegExp; name: string }[] = [
  { pattern: /\b(nlp|natural language processing)\b/i, name: "NLP" },
  { pattern: /\b(os|operating system|operating systems)\b/i, name: "OS" },
  { pattern: /\b(dbms|database|database management)\b/i, name: "DBMS" },
  { pattern: /\b(cn|computer networks?|networking)\b/i, name: "CN" },
  { pattern: /\b(ai|artificial intelligence)\b/i, name: "AI" },
  { pattern: /\b(ml|machine learning)\b/i, name: "ML" },
  { pattern: /\b(dl|deep learning)\b/i, name: "DL" },
  { pattern: /\b(daa|dsa|data structures?|algorithms?)\b/i, name: "DSA" },
  { pattern: /\b(compiler|compiler design|cd)\b/i, name: "Compiler Design" },
  { pattern: /\b(web tech|web technologies|wt|full stack)\b/i, name: "Web Tech" },
  { pattern: /\b(software engineering|se)\b/i, name: "SE" },
  { pattern: /\b(cloud computing|cloud|aws|gcp)\b/i, name: "Cloud" },
  { pattern: /\b(iot|internet of things)\b/i, name: "IoT" },
  { pattern: /\b(pfl|formal languages|automata|toc)\b/i, name: "Automata" },
  { pattern: /\b(maths?|mathematics|linear algebra|calculus|probability)\b/i, name: "Mathematics" },
  { pattern: /\b(fods|foundations of data science|23cse351)\b/i, name: "FoDS" },
  { pattern: /\b(cyber security|network security|infosec)\b/i, name: "Cybersecurity" }
];

const NON_ACADEMIC_PATTERNS = [
  /^(good\s+(morning|afternoon|evening|night)|gm|ge|gn)\b/i,
  /^(ok|okay|k|noted|yes|sure|thank\s*you|thanks|thx|got\s*it)(\s*[,!.]*\s*(sir|mam|ma'am|madam|all|noted|thanks|thank\s*you)?)*[\s.!👍🙏🎉❤️👏]*$/i,
  /^(happy\s+(birthday|diwali|pongal|new\s*year|holi|eid|teachers?\s*day))\b/i,
  /^congratulations?\b/i,
  /^[👍🙏🎉❤️👏\s]+$/
];

const ATTACHMENT_REGEX = /\b[\w-]+\.(?:pdf|ipynb|docx|doc|pptx|ppt|zip|csv|xlsx|png|jpg|jpeg)\b/gi;

/** Check if message is purely non-academic greeting or chatter */
export function isNonAcademicMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 3) return true;

  // 1. Promotional / Advertisement check
  if (isPromotionalMessage(trimmed)) return true;

  // 2. Pure attendance statement check (unless mixed with an academic event)
  if (isPureAttendanceMessage(trimmed)) return true;

  // 3. Has explicit non-academic match and no academic keywords
  const matchesNonAcademic = NON_ACADEMIC_PATTERNS.some(p => p.test(trimmed));
  const hasAcademicKeyword = /\b(exam|test|slip test|quiz|assignment|lab|project|submit|deadline|postpone|postponed|marks|grade|lecture|class|syllabus|record|session)\b/i.test(trimmed);

  return matchesNonAcademic && !hasAcademicKeyword;
}

/** Detect academic type */
export function detectType(text: string): AcademicType {
  const t = text.toLowerCase();
  if (/\b(slip\s*test\d*|st[- ]?[1-9])\b/.test(t)) return "SLIP_TEST";
  if (/\b(end semester|end-sem|end sem|mid term|midterm|internal|exam|examination|cat[- ]?[1-9]|unit test\d*|assessment)\b/.test(t)) return "EXAM";
  if (/\bquiz\d*\b/.test(t)) return "QUIZ";
  if (/\b(lab\d*|laboratory|experiment|slm|ipynb|jupyter)\b/.test(t)) return "LAB";
  if (/\b(project|mini project|capstone|repo)\b/.test(t)) return "PROJECT";
  if (/\b(presentation|ppt|seminar|slides)\b/.test(t)) return "PRESENTATION";
  if (/\b(course|certification|coursera|nptel|springboard)\b/.test(t)) return "COURSE";
  if (/\b(submit|submission|assignment\d*|upload|worksheet|homework|record)\b/.test(t)) return "ASSIGNMENT";
  if (/\b(announcement|notice|circular|collect|instruction|reminder|schedule)\b/.test(t)) return "ANNOUNCEMENT";
  return "OTHER";
}

/** Extract subject deterministically; return "NEEDS_CONFIRMATION" if missing */
export function detectSubject(text: string, sourceGroup?: string): string {
  // Check source group first if available
  if (sourceGroup) {
    for (const sub of COMMON_SUBJECTS) {
      if (sub.pattern.test(sourceGroup)) return sub.name;
    }
  }

  // Check text
  for (const sub of COMMON_SUBJECTS) {
    if (sub.pattern.test(text)) return sub.name;
  }

  return "NEEDS_CONFIRMATION";
}

/** Extract clean title from text */
export function detectTitle(text: string, type: AcademicType): string {
  const clean = text.replace(/\s+/g, " ").trim();

  // Pattern 1: Explicit test/exam named (e.g. "Slip test 2", "Unit Test 1", "Mid Term Exam")
  const testMatch = clean.match(/\b(slip\s*test\s*\d+|unit\s*test\s*\d+|mid\s*term\s*(?:exam)?\s*\d*|internal\s*assessment\s*\d*|cat\s*\d+)\b/i);
  if (testMatch) {
    const title = testMatch[0].replace(/\b\w/g, c => c.toUpperCase());
    return title;
  }

  // Pattern 2: "practice the <task>" or "complete the <task>" or "upload the <task>"
  const taskMatch = clean.match(/\b(?:practice|complete|solve|work on|upload)\s+(?:the\s+)?([a-z0-9_\-\s]{3,35}?)(?=\s+(?:and|before|by|at|in|on|submit|to|\.))/i);
  if (taskMatch && taskMatch[1].trim().length > 3) {
    const raw = taskMatch[1].trim();
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // Pattern 3: "Lab <n> ..." or "Assignment <n> ..."
  const numberedMatch = clean.match(/\b((?:lab|assignment|quiz|project)\s*\d+[^,.:;!?\n]{0,35})/i);
  if (numberedMatch) {
    const raw = numberedMatch[1].trim();
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // Pattern 4: "last date to <action>"
  const lastDateMatch = clean.match(/\blast date to\s+([^,.:;!?\n]{4,40})/i);
  if (lastDateMatch) {
    const raw = lastDateMatch[1].trim();
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // Pattern 5: First clause/sentence up to 60 chars
  const firstSentence = clean.split(/[.!?\n]/)[0].trim();
  if (firstSentence.length > 5 && firstSentence.length <= 60) {
    return firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  }

  // Fallback defaults by type
  const fallbacks: Record<AcademicType, string> = {
    ASSIGNMENT: "New Assignment",
    EXAM: "Upcoming Exam",
    SLIP_TEST: "Slip Test",
    QUIZ: "Upcoming Quiz",
    LAB: "Lab Task",
    PROJECT: "Project Assignment",
    PRESENTATION: "Presentation",
    COURSE: "Course / Certification",
    ANNOUNCEMENT: "Academic Announcement",
    OTHER: "Academic Notice"
  };

  return fallbacks[type];
}

export interface ModificationIntent {
  isModification: boolean;
  type?: "POSTPONEMENT" | "CANCELLATION" | "DEADLINE_EXTENSION" | "LINK_UPDATE" | "GENERAL_UPDATE";
  targetTitleSnippet?: string;
  newDate?: string;
  newTime?: string;
  newLink?: string;
  summary?: string;
}

/** Detect if a message intends to modify/postpone/cancel an existing event */
export function detectModificationIntent(text: string, referenceDate: Date = new Date()): ModificationIntent {
  const t = text.trim();

  // 1. Postponement: "is postponed to 3 October", "has been postponed from 30 September to 3 October", "rescheduled to Monday"
  const postponeMatch = t.match(/\b(?:is\s+|has\s+been\s+)?(?:postponed|rescheduled|deferred)(?:\s+from\s+[^.,;\n]+)?\s+(?:to|till|until)\s+([^.,;\n]+)/i);
  if (postponeMatch) {
    const datePart = postponeMatch[1].trim();
    const extractedDate = extractDateString(datePart, referenceDate);
    const extractedTime = extractTimeString(datePart) ?? extractTimeString(t);

    // Extract target title snippet (e.g., from "Slip Test 2 has been postponed...")
    const beforePostpone = t.split(/\b(?:is\s+|has\s+been\s+)?(?:postponed|rescheduled|deferred)\b/i)[0].trim();
    const targetMatch = beforePostpone.match(/\b(slip\s*test\s*\d+|lab\s*\d+|assignment\s*\d+|quiz\s*\d+|exam|test)\b/i);

    return {
      isModification: true,
      type: "POSTPONEMENT",
      targetTitleSnippet: targetMatch ? targetMatch[0] : (beforePostpone.length <= 40 ? beforePostpone : undefined),
      newDate: extractedDate?.dateStr,
      newTime: extractedTime,
      summary: extractedDate?.dateStr ? `Postponed to ${extractedDate.dateStr}${extractedTime ? ` · ${extractedTime}` : ""}` : "Postponed"
    };
  }

  // 2. Cancellation: "Slip test 2 is cancelled", "has been cancelled", "no exam tomorrow"
  const cancelMatch = t.match(/\b(?:is\s+|has\s+been\s+)?(?:cancelled|canceled|called\s*off)\b/i);
  if (cancelMatch) {
    const beforeCancel = t.split(/\b(?:is\s+|has\s+been\s+)?(?:cancelled|canceled|called\s*off)\b/i)[0].trim();
    const targetMatch = beforeCancel.match(/\b(slip\s*test\s*\d+|lab\s*\d+|assignment\s*\d+|quiz\s*\d+|exam|test)\b/i);

    return {
      isModification: true,
      type: "CANCELLATION",
      targetTitleSnippet: targetMatch ? targetMatch[0] : undefined,
      summary: "Event cancelled"
    };
  }

  // 3. Deadline extension: "deadline extended to ...", "submission date extended till ..."
  const extendMatch = t.match(/\b(?:deadline|last\s*date|submission)\s*(?:is\s*)?extended\s+(?:to|till|until)\s+([^.,;\n]+)/i);
  if (extendMatch) {
    const datePart = extendMatch[1].trim();
    const extractedDate = extractDateString(datePart, referenceDate);
    const extractedTime = extractTimeString(datePart) ?? extractTimeString(t);

    return {
      isModification: true,
      type: "DEADLINE_EXTENSION",
      newDate: extractedDate?.dateStr,
      newTime: extractedTime,
      summary: `Deadline extended${extractedDate ? ` to ${extractedDate.dateStr}` : ""}${extractedTime ? ` ${extractedTime}` : ""}`
    };
  }

  // 4. Link update: "new submission link: ...", "submit here instead: ..."
  const linkUpdateMatch = t.match(/\b(?:new|updated)\s*(?:submission\s*)?link\s*[:\-]?\s*(https?:\/\/[^\s]+)/i) ??
                          t.match(/\bsubmit\s+here\s+instead\s*[:\-]?\s*(https?:\/\/[^\s]+)/i);
  if (linkUpdateMatch) {
    return {
      isModification: true,
      type: "LINK_UPDATE",
      newLink: linkUpdateMatch[1],
      summary: "Submission link updated"
    };
  }

  return { isModification: false };
}

export interface ParsedAcademicMessage {
  title: string;
  subject: string;
  type: AcademicType;
  status: AcademicItem["status"];
  deadline?: string;
  eventDate?: string;
  eventTime?: string;
  submissionUrl?: string;
  resourceUrls: string[];
  attachmentNames: string[];
  description: string;
  sourceGroup?: string;
  sourceSender?: string;
  originalMessages: string[];
  modificationIntent: ModificationIntent;
  confidence: "HIGH" | "MEDIUM" | "NEEDS_CONFIRMATION";
}

/**
 * Deterministic parser for academic WhatsApp messages.
 * Designed with a clean interface so an AI structured-output parser can augment or replace it.
 */
export function parseAcademicMessage(
  text: string,
  options?: {
    sourceGroup?: string;
    sourceSender?: string;
    referenceDate?: Date;
  }
): ParsedAcademicMessage {
  const refDate = options?.referenceDate ?? new Date();
  const urls = text.match(URL_REGEX) ?? [];
  const attachments = Array.from(text.matchAll(ATTACHMENT_REGEX)).map(m => m[0]);
  const type = detectType(text);
  const subject = detectSubject(text, options?.sourceGroup);
  const title = detectTitle(text, type);
  const dateInfo = extractDateString(text, refDate);
  const timeInfo = extractTimeString(text) ?? dateInfo?.timeStr;
  const modIntent = detectModificationIntent(text, refDate);

  // Distinguish submission URL vs resource URLs
  let submissionUrl: string | undefined;
  const resourceUrls: string[] = [];

  for (const u of urls) {
    if (!submissionUrl && /\b(submit|submission|upload|forms\.gle|google\.com\/forms)\b/i.test(text)) {
      submissionUrl = u;
    } else {
      resourceUrls.push(u);
    }
  }

  // Format deadline if this is a submission-based task with date/time
  let deadline: string | undefined;
  let eventDate: string | undefined;
  let eventTime = timeInfo;

  if (dateInfo?.dateStr) {
    eventDate = dateInfo.dateStr;
    if (type === "EXAM" || type === "SLIP_TEST" || type === "QUIZ" || type === "PRESENTATION") {
      // eventDate is primary
    } else {
      // If it's a lab/assignment with a time, assemble deadline string
      if (timeInfo && dateInfo.isRelative) {
        // Build ISO string preserving local date
        const datePart = dateInfo.dateStr;
        deadline = `${datePart}T${formatTimeForIso(timeInfo)}`;
      } else {
        deadline = `${dateInfo.dateStr}T23:59:59`;
      }
    }
  }

  const confidence = (subject !== "NEEDS_CONFIRMATION" && (dateInfo || urls.length > 0))
    ? "HIGH"
    : subject === "NEEDS_CONFIRMATION"
      ? "NEEDS_CONFIRMATION"
      : "MEDIUM";

  return {
    title,
    subject,
    type,
    status: "INBOX",
    deadline,
    eventDate,
    eventTime,
    submissionUrl,
    resourceUrls,
    attachmentNames: attachments,
    description: text.trim(),
    sourceGroup: options?.sourceGroup,
    sourceSender: options?.sourceSender,
    originalMessages: [text.trim()],
    modificationIntent: modIntent,
    confidence
  };
}

function formatTimeForIso(timeStr: string): string {
  const match = timeStr.match(/(\d{1,2})[:.](\d{2})\s*([ap]m)?/i) ??
                timeStr.match(/(\d{1,2})\s*([ap]m)/i);
  if (!match) return "23:59:59";

  let hours = parseInt(match[1], 10);
  let minutes = 0;
  let ampm: string | undefined;

  if (match[2] && /^[ap]m$/i.test(match[2])) {
    ampm = match[2].toLowerCase();
  } else if (match[2]) {
    minutes = parseInt(match[2], 10);
    ampm = match[3]?.toLowerCase();
  }

  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  const hh = hours < 10 ? `0${hours}` : `${hours}`;
  const mm = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hh}:${mm}:00`;
}

/**
 * Parse a message that potentially contains multiple academic events or multiple dates.
 * Always returns an array of ParsedAcademicMessage. Single-event messages simply return an array of 1 item.
 */
export function parseMultipleAcademicMessages(
  text: string,
  options?: {
    sourceGroup?: string;
    sourceSender?: string;
    referenceDate?: Date;
  }
): ParsedAcademicMessage[] {
  const refDate = options?.referenceDate ?? new Date();
  const trimmed = text.trim();

  // 1. If this is a modification / postponement / cancellation, it modifies one existing event
  const modIntent = detectModificationIntent(trimmed, refDate);
  if (modIntent.isModification) {
    return [parseAcademicMessage(trimmed, options)];
  }

  // 2. Check compound independent clauses joined by "and", ";", or newlines
  // e.g. "OS exam next Tuesday and DBMS exam next Thursday"
  // e.g. "Quiz 2 will be on Monday and Assignment 3 is due Wednesday"
  const clauseSplits = trimmed.split(/\s+(?:and|&)\s+|;\s*|\n+/i);
  if (clauseSplits.length >= 2) {
    const hasAcademicKeywords = clauseSplits.map(clause =>
      /\b(exam|test|quiz|assignment|lab|project|presentation|course|deadline|due|submit)\b/i.test(clause)
    );
    const hasDistinctTasks = hasAcademicKeywords.filter(Boolean).length >= 2;

    if (hasDistinctTasks) {
      const parsedClauses: ParsedAcademicMessage[] = [];
      for (const clause of clauseSplits) {
        if (clause.trim().length > 3) {
          const parsed = parseAcademicMessage(clause.trim(), { ...options, referenceDate: refDate });
          parsedClauses.push(parsed);
        }
      }
      if (parsedClauses.length >= 2) {
        return parsedClauses;
      }
    }
  }

  // 3. Check for multiple dates in a message with a shared event/title
  // e.g. "Exams are next Tuesday and next Thursday."
  // e.g. "Lab exams are on Tuesday at 10 AM and Thursday at 2 PM."
  // e.g. "Internal exams next Tuesday, Thursday and Saturday."
  const multiDates = extractMultipleDates(trimmed, refDate);
  if (multiDates.length >= 2) {
    const baseParsed = parseAcademicMessage(trimmed, options);
    const results: ParsedAcademicMessage[] = [];

    // Clean base title (e.g. remove "are next Tuesday..." if present)
    let cleanBaseTitle = baseParsed.title;
    if (/\b(exams?|internal exams?|lab exams?|mid\s*term\s*exams?|slip\s*tests?)\b/i.test(trimmed)) {
      const examMatch = trimmed.match(/\b(internal\s*exams?|lab\s*exams?|mid\s*term\s*exams?|slip\s*tests?|exams?)\b/i);
      if (examMatch) {
        cleanBaseTitle = examMatch[0].replace(/\b\w/g, c => c.toUpperCase());
        if (cleanBaseTitle.endsWith("s") && !cleanBaseTitle.endsWith("ss")) {
          cleanBaseTitle = cleanBaseTitle.slice(0, -1);
        }
      }
    }

    for (const occ of multiDates) {
      const occurrenceTitle = `${cleanBaseTitle} — ${occ.dayName || occ.dateStr}`;
      const occurrenceTime = occ.timeStr ?? baseParsed.eventTime;

      let occurrenceDeadline: string | undefined;
      let occurrenceEventDate: string | undefined = occ.dateStr;

      if (baseParsed.type === "EXAM" || baseParsed.type === "SLIP_TEST" || baseParsed.type === "QUIZ" || baseParsed.type === "PRESENTATION") {
        occurrenceEventDate = occ.dateStr;
      } else {
        occurrenceDeadline = occurrenceTime
          ? `${occ.dateStr}T${formatTimeForIso(occurrenceTime)}`
          : `${occ.dateStr}T23:59:59`;
      }

      results.push({
        ...baseParsed,
        title: occurrenceTitle,
        eventDate: occurrenceEventDate,
        eventTime: occurrenceTime,
        deadline: occurrenceDeadline,
        description: trimmed
      });
    }

    return results;
  }

  // 4. Fallback to single-event message
  return [parseAcademicMessage(trimmed, options)];
}