/**
 * Date and time utilities for Academic Command Center.
 * Handles local date normalization without timezone shift bugs.
 */

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export interface ExtractedDate {
  dateStr: string; // YYYY-MM-DD
  timeStr?: string; // e.g. "11:35 AM", "First hour"
  isRelative: boolean;
  confidence: "HIGH" | "MEDIUM" | "NEEDS_CONFIRMATION";
}

/** Pad single digit with zero */
export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Get local date string YYYY-MM-DD from a Date object */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

/**
 * Format calendar date (YYYY-MM-DD) for display without UTC date shift
 */
export function formatCalendarDate(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const monthName = MONTH_NAMES[m - 1] ?? "";
  return `${d} ${monthName} ${y}`;
}

/**
 * Check if a date string (YYYY-MM-DD or ISO) is today
 */
export function isToday(dateStrOrIso?: string, referenceDate: Date = new Date()): boolean {
  if (!dateStrOrIso) return false;
  const todayStr = toLocalDateString(referenceDate);
  const targetDateStr = dateStrOrIso.length >= 10 ? dateStrOrIso.slice(0, 10) : dateStrOrIso;
  return targetDateStr === todayStr;
}

/**
 * Check if a date string is in the future compared to reference date
 */
export function isUpcoming(dateStrOrIso?: string, referenceDate: Date = new Date()): boolean {
  if (!dateStrOrIso) return false;
  const todayStr = toLocalDateString(referenceDate);
  const targetDateStr = dateStrOrIso.length >= 10 ? dateStrOrIso.slice(0, 10) : dateStrOrIso;
  return targetDateStr > todayStr;
}

/**
 * Check if a date/deadline is overdue compared to reference date
 */
export function isOverdue(
  deadlineOrEventDate?: string,
  eventTime?: string,
  referenceDate: Date = new Date()
): boolean {
  if (!deadlineOrEventDate) return false;

  // If ISO deadline with time
  if (deadlineOrEventDate.includes("T")) {
    const deadlineTime = new Date(deadlineOrEventDate).getTime();
    if (!isNaN(deadlineTime)) {
      return deadlineTime < referenceDate.getTime();
    }
  }

  // If plain YYYY-MM-DD
  const targetDateStr = deadlineOrEventDate.slice(0, 10);
  const todayStr = toLocalDateString(referenceDate);
  if (targetDateStr < todayStr) return true;

  // If same day, check eventTime if parses into hours/minutes
  if (targetDateStr === todayStr && eventTime) {
    const parsedTime = parseTimeComponents(eventTime);
    if (parsedTime) {
      const targetTime = new Date(referenceDate);
      targetTime.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
      return targetTime.getTime() < referenceDate.getTime();
    }
  }

  return false;
}

/** Parse hours and minutes from time string like "11:35 am" */
function parseTimeComponents(text: string): { hours: number; minutes: number } | null {
  const match = text.match(/(\d{1,2})[:.](\d{2})(?:\s*([ap]m))?/i) ??
                text.match(/(\d{1,2})\s*([ap]m)/i);
  if (!match) return null;

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

  return { hours, minutes };
}

/**
 * Extract time string from text: e.g. "11:35 am", "11.35 AM", "5 pm", "first hour"
 */
export function extractTimeString(text: string): string | undefined {
  // First hour / 2nd hour / 1st period
  const periodMatch = text.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s*(hour|period|slot)\b/i);
  if (periodMatch) {
    const raw = periodMatch[0];
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }

  // Exact time like 11:35 am or 11.35 AM or 11:35am
  const timeMatch = text.match(/\b(?:before|at|by|until|till)?\s*(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\b/i) ??
                    text.match(/\b(?:before|at|by|until|till)?\s*(\d{1,2}\s*(?:am|pm))\b/i);
  if (timeMatch) {
    let clean = timeMatch[1].trim().replace(/\./, ":");
    if (!clean.includes(":")) {
      clean = clean.replace(/^(\d{1,2})\s*([ap]m)$/i, "$1:00 $2");
    }
    // Standardize AM/PM casing
    return clean.replace(/([ap]m)/i, (_, s) => " " + s.toUpperCase()).replace(/\s+/, " ").trim();
  }

  return undefined;
}

export const DAY_OF_WEEK_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6
};

/**
 * Resolve relative day of week (e.g. "Monday", "next Tuesday", "this Thursday") to a concrete Date
 */
export function resolveRelativeDay(
  dayName: string,
  referenceDate: Date = new Date(),
  modifier?: "this" | "next" | null,
  minDate?: Date
): Date {
  const targetDay = DAY_OF_WEEK_MAP[dayName.toLowerCase()];
  if (targetDay === undefined) return new Date(referenceDate);

  const result = new Date(referenceDate);
  const currentDay = referenceDate.getDay();

  let diff = (targetDay - currentDay + 7) % 7;

  if (modifier === "next") {
    if (diff === 0) {
      diff = 7;
    } else if (currentDay === 0 || currentDay >= 5) {
      // Friday, Saturday, Sunday: "next Tuesday" means Tuesday of the upcoming week (diff is already +2..+5)
    } else if (diff <= 3) {
      // Mon-Thu: "next <day>" for a day closely ahead (1-3 days) refers to next week
      diff += 7;
    }
  } else if (modifier === "this") {
    // "this Monday" -> upcoming Monday (or today if diff === 0)
  } else {
    // No modifier: if today is target day, default to next occurrence (+7 days)
    if (diff === 0) {
      diff = 7;
    }
  }

  result.setDate(referenceDate.getDate() + diff);

  // If minDate is provided, ensure result is on or after minDate
  if (minDate && result < minDate) {
    while (result < minDate) {
      result.setDate(result.getDate() + 7);
    }
  }

  return result;
}

export interface ExtractedOccurrenceDate {
  dateStr: string; // YYYY-MM-DD
  timeStr?: string; // e.g. "10:00 AM", "2:00 PM"
  rawDateSnippet: string; // e.g. "next Tuesday", "Thursday at 2 PM"
  dayName?: string; // e.g. "Tuesday", "Thursday"
  isRelative: boolean;
}

/**
 * Extract multiple dates from text, preserving sequence and resolving relative references
 */
export function extractMultipleDates(
  text: string,
  referenceDate: Date = new Date()
): ExtractedOccurrenceDate[] {
  const results: ExtractedOccurrenceDate[] = [];
  const t = text.trim();

  // Pattern for relative day mentions: (this|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+[\d:.]+\s*(?:am|pm)?)?
  const dayPattern = /\b(?:(this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b(?:\s+(?:at|by|before)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?))?/gi;

  let lastDate: Date | undefined;
  let match: RegExpExecArray | null;

  while ((match = dayPattern.exec(t)) !== null) {
    const modifier = (match[1]?.toLowerCase() as "this" | "next") || null;
    const dayName = match[2];
    const timeRaw = match[3];

    // Compute concrete date
    const concrete = resolveRelativeDay(dayName, referenceDate, modifier, lastDate);
    lastDate = concrete;

    const timeStr = timeRaw ? extractTimeString(timeRaw) : undefined;
    const fullSnippet = match[0].trim();

    // Avoid duplicate identical dates in the exact same index
    results.push({
      dateStr: toLocalDateString(concrete),
      timeStr,
      rawDateSnippet: fullSnippet,
      dayName: dayName.charAt(0).toUpperCase() + dayName.slice(1).toLowerCase(),
      isRelative: true
    });
  }

  return results;
}

/**
 * Extract date from text with reference date
 */
export function extractDateString(
  text: string,
  referenceDate: Date = new Date()
): ExtractedDate | undefined {
  const t = text.trim();
  const currentYear = referenceDate.getFullYear();

  // 1. Check relative: today / tonight
  if (/\b(today|tonight)\b/i.test(t)) {
    const dateStr = toLocalDateString(referenceDate);
    const timeStr = extractTimeString(t);
    return {
      dateStr,
      timeStr,
      isRelative: true,
      confidence: "HIGH"
    };
  }

  // 2. Check relative: tomorrow
  if (/\b(tomorrow)\b/i.test(t)) {
    const nextDay = new Date(referenceDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const dateStr = toLocalDateString(nextDay);
    const timeStr = extractTimeString(t);
    return {
      dateStr,
      timeStr,
      isRelative: true,
      confidence: "HIGH"
    };
  }

  // 3. Check relative: day after tomorrow
  if (/\bday\s+after\s+tomorrow\b/i.test(t)) {
    const nextDay = new Date(referenceDate);
    nextDay.setDate(nextDay.getDate() + 2);
    const dateStr = toLocalDateString(nextDay);
    const timeStr = extractTimeString(t);
    return {
      dateStr,
      timeStr,
      isRelative: true,
      confidence: "HIGH"
    };
  }

  // 4. Check relative day of week: "next Tuesday", "this Monday", "Monday", etc.
  const dayMatch = t.match(/\b(?:(this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i);
  if (dayMatch) {
    const modifier = (dayMatch[1]?.toLowerCase() as "this" | "next") || null;
    const dayName = dayMatch[2];
    const resolved = resolveRelativeDay(dayName, referenceDate, modifier);
    return {
      dateStr: toLocalDateString(resolved),
      timeStr: extractTimeString(t),
      isRelative: true,
      confidence: "HIGH"
    };
  }

  // 5. Numeric DD-MM-YYYY or DD/MM/YYYY or YYYY-MM-DD
  const dmyMatch = t.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return {
        dateStr: `${year}-${pad2(month)}-${pad2(day)}`,
        timeStr: extractTimeString(t),
        isRelative: false,
        confidence: "HIGH"
      };
    }
  }

  const ymdMatch = t.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return {
        dateStr: `${year}-${pad2(month)}-${pad2(day)}`,
        timeStr: extractTimeString(t),
        isRelative: false,
        confidence: "HIGH"
      };
    }
  }

  // 6. Named month format: "30 Sep 2026", "30th September", "3 October", "Oct 3"
  const dayMonthMatch = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?\b/) ??
                        t.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b/);

  if (dayMonthMatch) {
    let day: number;
    let monthWord: string;
    let year: number;

    if (/^\d/.test(dayMonthMatch[1])) {
      day = parseInt(dayMonthMatch[1], 10);
      monthWord = dayMonthMatch[2].toLowerCase();
      year = dayMonthMatch[3] ? parseInt(dayMonthMatch[3], 10) : currentYear;
    } else {
      monthWord = dayMonthMatch[1].toLowerCase();
      day = parseInt(dayMonthMatch[2], 10);
      year = dayMonthMatch[3] ? parseInt(dayMonthMatch[3], 10) : currentYear;
    }

    const monthNum = MONTH_MAP[monthWord];
    if (monthNum && day >= 1 && day <= 31) {
      return {
        dateStr: `${year}-${pad2(monthNum)}-${pad2(day)}`,
        timeStr: extractTimeString(t),
        isRelative: false,
        confidence: "HIGH"
      };
    }
  }

  // 7. Time only (e.g., "before 11:35 am")
  const timeOnly = extractTimeString(t);
  if (timeOnly) {
    return {
      dateStr: toLocalDateString(referenceDate),
      timeStr: timeOnly,
      isRelative: true,
      confidence: "MEDIUM"
    };
  }

  return undefined;
}

/**
 * Format deadline with humanized status
 */
export function formatDeadlineDisplay(deadlineIso?: string, referenceDate: Date = new Date()): string {
  if (!deadlineIso) return "";
  const d = new Date(deadlineIso);
  if (isNaN(d.getTime())) return deadlineIso;

  const dateStr = toLocalDateString(d);
  const todayStr = toLocalDateString(referenceDate);

  const tomorrow = new Date(referenceDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toLocalDateString(tomorrow);

  const timeFormatted = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (dateStr === todayStr) {
    return `Today at ${timeFormatted}`;
  }
  if (dateStr === tomorrowStr) {
    return `Tomorrow at ${timeFormatted}`;
  }
  return `${formatCalendarDate(dateStr)} · ${timeFormatted}`;
}

export const BACKFILL_BOUNDARY_DATE = "2026-09-10T00:00:00+05:30";

/**
 * Parse WhatsApp Web timestamp format e.g. "[11:35 am, 25/09/2026]" or "25/09/2026, 11:35 am"
 * into a standardized ISO 8601 string.
 */
export function parseWhatsAppMessageTimestamp(rawText: string): string {
  if (!rawText) return new Date().toISOString();
  const trimmed = rawText.trim();

  // If already standard ISO representation
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Format 1: [11:35 am, 25/09/2026] or [25/09/2026, 11:35 am]
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

    // Check which one is the date (contains / or - or 4 digits)
    if (!/\d{1,4}[/-]\d{1,2}[/-]\d{2,4}/.test(datePart) && /\d{1,4}[/-]\d{1,2}[/-]\d{2,4}/.test(timePart)) {
      datePart = p2;
      timePart = p1;
    }

    // Parse datePart (DD/MM/YYYY or MM/DD/YYYY or YYYY-MM-DD)
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

    // Parse timePart (HH:MM or HH:MM:SS with optional am/pm)
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

    // Format ISO string in Asia/Kolkata (+05:30)
    const isoString = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}+05:30`;
    const parsedDate = new Date(isoString);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  // Fallback: Date.parse
  const direct = new Date(trimmed);
  if (!isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  return new Date().toISOString();
}

/**
 * Returns true if message was sent on or after the September 10, 2026 backfill boundary.
 */
export function isMessageEligibleForBackfill(
  timestampStr: string,
  boundaryIso: string = BACKFILL_BOUNDARY_DATE
): boolean {
  try {
    const msgTime = new Date(timestampStr).getTime();
    const boundaryTime = new Date(boundaryIso).getTime();
    return msgTime >= boundaryTime;
  } catch {
    return true;
  }
}

/**
 * Returns true if message is strictly newer than the group's current saved cursor.
 */
export function isMessageNewerThanCursor(
  timestampStr: string,
  cursorTimestamp?: string | null
): boolean {
  if (!cursorTimestamp) return true;
  try {
    const msgTime = new Date(timestampStr).getTime();
    const cursorTime = new Date(cursorTimestamp).getTime();
    return msgTime > cursorTime;
  } catch {
    return true;
  }
}

