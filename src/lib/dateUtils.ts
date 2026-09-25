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
    const clean = timeMatch[1].trim().replace(/\./, ":");
    // Standardize AM/PM casing
    return clean.replace(/([ap]m)/i, (_, s) => " " + s.toUpperCase()).replace(/\s+/, " ").trim();
  }

  return undefined;
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

  // 1. Check relative: today / tomorrow
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

  // 2. Numeric DD-MM-YYYY or DD/MM/YYYY or YYYY-MM-DD
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

  // 3. Named month format: "30 Sep 2026", "30th September", "3 October", "Oct 3"
  // e.g. "30-09-2026", "30 September 2026", "3 October", "Oct 3rd"
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

  // 4. Time only (e.g., "before 11:35 am")
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
