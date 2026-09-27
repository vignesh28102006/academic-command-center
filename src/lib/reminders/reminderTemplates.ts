import { AcademicItem } from "../types";
import { ReminderType, ReminderPriority, MorningBriefingData } from "./reminderTypes";
import { formatCalendarDate, toLocalDateString } from "../dateUtils";

/**
 * Format relative interval description (e.g. "tomorrow", "in 3 days", "in 1 hour")
 */
export function formatIntervalDescription(reminderType: ReminderType, timeRemainingMs: number): string {
  switch (reminderType) {
    case "7d":
      return "in 7 days";
    case "3d":
      return "in 3 days";
    case "1d":
      return "tomorrow";
    case "3h":
      return "in 3 hours";
    case "1h":
      return "in 1 hour";
    case "OVERDUE":
      return "is overdue";
    case "CONFIRMATION_NEEDED":
      return "needs confirmation";
    default:
      if (timeRemainingMs <= 0) return "now";
      const hours = Math.round(timeRemainingMs / (1000 * 60 * 60));
      if (hours < 24) return `in ${hours} hours`;
      const days = Math.round(hours / 24);
      return `in ${days} days`;
  }
}

/**
 * Extract display time from an event (deadline or eventTime)
 */
export function getDisplayTimeString(event: AcademicItem): string {
  if (event.eventTime) return event.eventTime;
  if (event.deadlineTime) return event.deadlineTime;

  if (event.deadline && event.deadline.includes("T")) {
    try {
      const d = new Date(event.deadline);
      // Format time in Asia/Kolkata timezone
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const ampm = hours >= 12 ? "PM" : "AM";
      const h12 = hours % 12 || 12;
      if (hours === 23 && minutes === 59) return "11:59 PM";
      return `${h12}:${pad2(minutes)} ${ampm}`;
    } catch (_) {}
  }

  return "11:59 PM";
}

/**
 * Calculate deterministic reminder priority
 */
export function calculateReminderPriority(
  event: AcademicItem,
  reminderType: ReminderType,
  timeRemainingMs: number
): ReminderPriority {
  if (reminderType === "OVERDUE") {
    return "URGENT";
  }

  if (event.needsConfirmation || reminderType === "CONFIRMATION_NEEDED") {
    return "REVIEW";
  }

  if (event.type === "EXAM" || event.type === "SLIP_TEST") {
    if (timeRemainingMs <= 24 * 60 * 60 * 1000) return "URGENT";
    return "HIGH";
  }

  if (reminderType === "1h" || reminderType === "3h" || timeRemainingMs <= 3 * 60 * 60 * 1000) {
    return "URGENT";
  }

  if (reminderType === "1d" || reminderType === "3d" || timeRemainingMs <= 24 * 60 * 60 * 1000) {
    return "HIGH";
  }

  return "NORMAL";
}

/**
 * Format deterministic reminder text tailored to event type
 */
export function formatReminderMessage(
  event: AcademicItem,
  reminderType: ReminderType,
  timeRemainingMs: number = 0
): string {
  const subjectPrefix = event.subject && event.subject !== "NEEDS_CONFIRMATION" ? `${event.subject} ` : "";
  const timeStr = getDisplayTimeString(event);
  const timeDesc = formatIntervalDescription(reminderType, timeRemainingMs);

  // 1. Needs Confirmation Rule: NEVER invent a deadline
  if (event.needsConfirmation || reminderType === "CONFIRMATION_NEEDED") {
    return `${subjectPrefix}${event.title} — deadline unclear. Please confirm the deadline.`;
  }

  // 2. Overdue Rule
  if (reminderType === "OVERDUE") {
    const dueStr = event.deadline ? formatCalendarDate(event.deadline.slice(0, 10)) : event.eventDate ? formatCalendarDate(event.eventDate) : "earlier";
    let base = `${subjectPrefix}${event.title} was due on ${dueStr} and is overdue.`;
    if (event.submissionUrl) {
      base += ` Open Submission: ${event.submissionUrl}`;
    }
    return base;
  }

  // 3. Event Type Specific Formulations
  let message = "";
  switch (event.type) {
    case "ASSIGNMENT":
      if (reminderType === "1d") {
        message = `${subjectPrefix}${event.title} is due tomorrow at ${timeStr}.`;
      } else if (reminderType === "1h" || reminderType === "3h") {
        message = `${subjectPrefix}${event.title} is due ${timeDesc} at ${timeStr}.`;
      } else {
        message = `${subjectPrefix}${event.title} is due ${timeDesc}.`;
      }
      break;

    case "EXAM":
      if (reminderType === "1d") {
        message = `${subjectPrefix}${event.title} exam is tomorrow at ${timeStr}.`;
      } else {
        message = `${subjectPrefix}${event.title} exam is ${timeDesc} at ${timeStr}.`;
      }
      break;

    case "SLIP_TEST":
      if (reminderType === "1d") {
        message = `${subjectPrefix}${event.title} is tomorrow at ${timeStr}.`;
      } else {
        message = `${subjectPrefix}${event.title} is ${timeDesc} at ${timeStr}.`;
      }
      break;

    case "QUIZ":
      if (reminderType === "1d") {
        message = `${subjectPrefix}${event.title} Quiz is tomorrow at ${timeStr}.`;
      } else {
        message = `${subjectPrefix}${event.title} Quiz is ${timeDesc} at ${timeStr}.`;
      }
      break;

    case "PROJECT":
      message = `${subjectPrefix}${event.title} submission is due ${timeDesc}.`;
      break;

    case "LAB":
      if (reminderType === "1d") {
        message = `${subjectPrefix}${event.title} is due tomorrow at ${timeStr}.`;
      } else {
        message = `${subjectPrefix}${event.title} is due ${timeDesc} at ${timeStr}.`;
      }
      break;

    case "PRESENTATION":
      message = `${subjectPrefix}${event.title} presentation is ${timeDesc} at ${timeStr}.`;
      break;

    case "ANNOUNCEMENT":
      message = `${subjectPrefix}Announcement: ${event.title} (${timeDesc}).`;
      break;

    default:
      message = `${subjectPrefix}${event.title} is ${timeDesc} at ${timeStr}.`;
      break;
  }

  // Submission link attachment if present
  if (event.submissionUrl) {
    message += ` Open Submission: ${event.submissionUrl}`;
  }

  return message;
}

/**
 * Format deterministic Morning Briefing text
 */
export function formatMorningBriefingText(briefing: MorningBriefingData): string {
  const lines: string[] = ["GOOD MORNING", ""];

  // 1. Today
  lines.push("Today:");
  if (briefing.today.length === 0) {
    lines.push("• No items due today.");
  } else {
    for (const item of briefing.today) {
      const time = getDisplayTimeString(item);
      const sub = item.subject && item.subject !== "NEEDS_CONFIRMATION" ? `${item.subject} ` : "";
      lines.push(`• ${sub}${item.title} — ${time}`);
    }
  }
  lines.push("");

  // 2. Tomorrow
  lines.push("Tomorrow:");
  if (briefing.tomorrow.length === 0) {
    lines.push("• Nothing scheduled for tomorrow.");
  } else {
    for (const item of briefing.tomorrow) {
      const time = getDisplayTimeString(item);
      const sub = item.subject && item.subject !== "NEEDS_CONFIRMATION" ? `${item.subject} ` : "";
      lines.push(`• ${sub}${item.title} — ${time}`);
    }
  }
  lines.push("");

  // 3. Upcoming (next 7 days)
  lines.push("Upcoming:");
  if (briefing.upcoming.length === 0) {
    lines.push("• No other upcoming deadlines in the next 7 days.");
  } else {
    for (const item of briefing.upcoming) {
      const dateStr = item.deadline ? item.deadline.slice(0, 10) : item.eventDate || "";
      const formattedDate = formatCalendarDate(dateStr);
      const sub = item.subject && item.subject !== "NEEDS_CONFIRMATION" ? `${item.subject} ` : "";
      lines.push(`• ${sub}${item.title} — ${formattedDate}`);
    }
  }
  lines.push("");

  // 4. Needs Confirmation
  if (briefing.needsConfirmation.length > 0) {
    lines.push("Needs Confirmation:");
    for (const item of briefing.needsConfirmation) {
      const sub = item.subject && item.subject !== "NEEDS_CONFIRMATION" ? `${item.subject} ` : "";
      lines.push(`• ${sub}${item.title} — deadline unclear`);
    }
    lines.push("");
  }

  // 5. Overdue
  if (briefing.overdue.length > 0) {
    lines.push("Overdue:");
    for (const item of briefing.overdue) {
      const sub = item.subject && item.subject !== "NEEDS_CONFIRMATION" ? `${item.subject} ` : "";
      lines.push(`• ${sub}${item.title} — overdue`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}
