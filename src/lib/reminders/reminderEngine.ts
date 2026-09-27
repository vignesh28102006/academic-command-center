import { AcademicItem } from "../types";
import {
  ReminderItem,
  ReminderSettings,
  ReminderType,
  GenerateRemindersResult,
  MorningBriefingData,
  ReminderNotification
} from "./reminderTypes";
import {
  calculateReminderPriority,
  formatReminderMessage,
  formatMorningBriefingText
} from "./reminderTemplates";
import {
  getAllReminders,
  createReminder,
  updateReminder,
  cancelRemindersForEvent,
  getReminderSettings,
  getDueReminders
} from "../db/reminders";
import { getAllAcademicEvents } from "../db/academicEvents";
import { dispatchNotification } from "./notificationProvider";
import { pad2, toLocalDateString } from "../dateUtils";

const INTERVAL_OFFSETS: Record<string, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "1h": 1 * 60 * 60 * 1000
};

/**
 * Parse time components from a string like "10:00 AM", "2:00 PM", "11:35 am", "First hour", "23:59"
 */
function parseTimeString(timeStr?: string): { hours: number; minutes: number } {
  if (!timeStr) return { hours: 23, minutes: 59 };

  const clean = timeStr.trim().toLowerCase();

  if (clean.includes("first hour") || clean.includes("1st hour") || clean.includes("period 1")) {
    return { hours: 9, minutes: 0 };
  }
  if (clean.includes("second hour") || clean.includes("2nd hour") || clean.includes("period 2")) {
    return { hours: 10, minutes: 0 };
  }
  if (clean.includes("third hour") || clean.includes("3rd hour") || clean.includes("period 3")) {
    return { hours: 11, minutes: 0 };
  }

  const match = clean.match(/(\d{1,2})[:.](\d{2})(?:\s*([ap]m))?/i) ??
                clean.match(/(\d{1,2})\s*([ap]m)/i);

  if (!match) {
    return { hours: 23, minutes: 59 };
  }

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
 * Resolve target datetime for an academic event respecting deadline vs eventDate
 */
export function getEventTargetDate(event: AcademicItem): Date | null {
  // Assignments, Projects, Labs: deadline is primary
  const isDeadlinePrimary = event.type === "ASSIGNMENT" || event.type === "PROJECT" || event.type === "LAB";

  if (isDeadlinePrimary && event.deadline) {
    const d = new Date(event.deadline);
    if (!isNaN(d.getTime())) return d;
  }

  // Exams, Slip tests, Quizzes, Presentations: eventDate is primary
  if (event.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(event.eventDate)) {
    const [y, m, d] = event.eventDate.split("-").map(Number);
    const { hours, minutes } = parseTimeString(event.eventTime || event.deadlineTime || (isDeadlinePrimary ? "23:59" : "10:00 AM"));
    const isoWithOffset = `${y}-${pad2(m)}-${pad2(d)}T${pad2(hours)}:${pad2(minutes)}:00+05:30`;
    const parsed = new Date(isoWithOffset);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Fallback to deadline if eventDate wasn't available
  if (event.deadline) {
    const d = new Date(event.deadline);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * Check if event is overdue relative to referenceDate
 */
export function isEventOverdue(event: AcademicItem, referenceDate: Date = new Date()): boolean {
  if (event.status === "COMPLETED" || event.status === "CANCELLED" || event.status === "SUBMITTED") {
    return false;
  }
  const target = getEventTargetDate(event);
  if (!target) return false;
  return target.getTime() < referenceDate.getTime();
}

/**
 * Calculate applicable reminders for a single academic event
 */
export function calculateApplicableReminders(
  event: AcademicItem,
  settings: ReminderSettings,
  referenceDate: Date = new Date()
): Array<Omit<ReminderItem, "id" | "createdAt" | "updatedAt">> {
  // 1. Status Filter: Never remind for CANCELLED or COMPLETED events
  if (event.status === "CANCELLED" || event.status === "COMPLETED" || event.status === "SUBMITTED") {
    return [];
  }

  // 2. Settings check
  const isExam = event.type === "EXAM" || event.type === "SLIP_TEST" || event.type === "QUIZ";
  if (isExam && !settings.exam_reminders_enabled) {
    return [];
  }
  if (!isExam && !settings.deadline_reminders_enabled) {
    return [];
  }

  const results: Array<Omit<ReminderItem, "id" | "createdAt" | "updatedAt">> = [];
  const eventVersion = event.eventVersion || 1;
  const refTimeMs = referenceDate.getTime();

  // 3. Needs Confirmation check without deadline
  if (event.needsConfirmation) {
    const target = getEventTargetDate(event);
    if (!target) {
      const scheduledFor = referenceDate.toISOString();
      const msg = formatReminderMessage(event, "CONFIRMATION_NEEDED", 0);
      results.push({
        eventId: event.id,
        reminderType: "CONFIRMATION_NEEDED",
        scheduledFor,
        sentAt: null,
        status: "SCHEDULED",
        notificationChannel: "CONSOLE",
        message: msg,
        eventVersion,
        priority: "REVIEW",
        submissionUrl: event.submissionUrl,
        dedupKey: `${event.id}_v${eventVersion}_CONFIRMATION_NEEDED_${scheduledFor.slice(0, 10)}`,
        eventTitle: event.title,
        eventSubject: event.subject,
        eventType: event.type
      });
      return results;
    }
  }

  const targetDate = getEventTargetDate(event);
  if (!targetDate) return [];

  const targetTimeMs = targetDate.getTime();

  // 4. Overdue Policy
  if (targetTimeMs < refTimeMs) {
    const refDayStr = toLocalDateString(referenceDate);
    const scheduledFor = referenceDate.toISOString();
    const msg = formatReminderMessage(event, "OVERDUE", 0);

    results.push({
      eventId: event.id,
      reminderType: "OVERDUE",
      scheduledFor,
      sentAt: null,
      status: "SCHEDULED",
      notificationChannel: "CONSOLE",
      message: msg,
      eventVersion,
      priority: "URGENT",
      submissionUrl: event.submissionUrl,
      // Controlled overdue policy: one overdue reminder per event per day
      dedupKey: `${event.id}_v${eventVersion}_OVERDUE_${refDayStr}`,
      eventTitle: event.title,
      eventSubject: event.subject,
      eventType: event.type
    });
    return results;
  }

  // 5. Future Reminder Intervals (7d, 3d, 1d, 3h, 1h)
  const intervals = settings.default_reminder_intervals || ["7d", "3d", "1d", "3h", "1h"];

  for (const interval of intervals) {
    const offset = INTERVAL_OFFSETS[interval];
    if (!offset) continue;

    const scheduledTimeMs = targetTimeMs - offset;
    const timeRemainingMs = targetTimeMs - scheduledTimeMs;

    // Rule 4: DO NOT create reminders if event is too close (scheduled time is in the past)
    // Allow up to 15-minute grace window if due right now
    if (scheduledTimeMs < refTimeMs - 15 * 60 * 1000) {
      continue;
    }

    const scheduledDate = new Date(scheduledTimeMs);
    const scheduledIso = scheduledDate.toISOString();
    const reminderType = interval as ReminderType;
    const msg = formatReminderMessage(event, reminderType, timeRemainingMs);
    const priority = calculateReminderPriority(event, reminderType, timeRemainingMs);

    results.push({
      eventId: event.id,
      reminderType,
      scheduledFor: scheduledIso,
      sentAt: null,
      status: "SCHEDULED",
      notificationChannel: "CONSOLE",
      message: msg,
      eventVersion,
      priority,
      submissionUrl: event.submissionUrl,
      dedupKey: `${event.id}_v${eventVersion}_${reminderType}_${scheduledIso}`,
      eventTitle: event.title,
      eventSubject: event.subject,
      eventType: event.type
    });
  }

  return results;
}

/**
 * Generate and synchronize reminders from Supabase events
 */
export async function generateReminders(
  referenceDate: Date = new Date(),
  dispatchDue: boolean = true
): Promise<GenerateRemindersResult> {
  const result: GenerateRemindersResult = {
    scannedEvents: 0,
    remindersCreated: 0,
    remindersCancelled: 0,
    remindersSent: 0,
    activeRemindersCount: 0,
    errors: []
  };

  try {
    // 1. Fetch settings
    const settings = await getReminderSettings();
    if (!settings.enabled) {
      const active = await getAllReminders({ status: "SCHEDULED" });
      result.activeRemindersCount = active.length;
      return result;
    }

    // 2. Fetch all academic events
    const events = await getAllAcademicEvents();
    result.scannedEvents = events.length;

    // 3. Fetch existing reminders to compare
    const existingReminders = await getAllReminders();
    const existingMap = new Map<string, ReminderItem>();
    existingReminders.forEach(r => {
      if (r.dedupKey) existingMap.set(r.dedupKey, r);
    });

    // 4. Process each event
    for (const ev of events) {
      const currentVersion = ev.eventVersion || 1;

      // Invalidation 1: If event is CANCELLED or COMPLETED, cancel all future scheduled reminders
      if (ev.status === "CANCELLED" || ev.status === "COMPLETED" || ev.status === "SUBMITTED") {
        const cancelledCount = await cancelRemindersForEvent(ev.id, `Event ${ev.status.toLowerCase()}`, true);
        result.remindersCancelled += cancelledCount;
        continue;
      }

      // Invalidation 2: Postponements / modifications:
      // Cancel any existing SCHEDULED reminders for this event that belong to an older eventVersion
      const evReminders = existingReminders.filter(r => r.eventId === ev.id && r.status === "SCHEDULED");
      for (const r of evReminders) {
        if (r.eventVersion < currentVersion) {
          await updateReminder(r.id, { status: "CANCELLED" });
          result.remindersCancelled++;
        }
      }

      // Calculate applicable reminders
      const applicable = calculateApplicableReminders(ev, settings, referenceDate);

      for (const req of applicable) {
        if (req.dedupKey && existingMap.has(req.dedupKey)) {
          continue; // Already scheduled/sent, prevent duplicate
        }

        const created = await createReminder(req);
        if (created) {
          result.remindersCreated++;
          if (created.dedupKey) {
            existingMap.set(created.dedupKey, created);
          }
        }
      }
    }

    // 5. Dispatch due reminders
    if (dispatchDue) {
      const dueReminders = await getDueReminders(referenceDate);
      for (const due of dueReminders) {
        const notif: ReminderNotification = {
          id: due.id,
          reminderId: due.id,
          eventId: due.eventId,
          title: `Academic Command Center: ${due.eventSubject || "Academic Alert"}`,
          body: due.message,
          channel: due.notificationChannel,
          priority: due.priority || "NORMAL",
          submissionUrl: due.submissionUrl,
          scheduledFor: due.scheduledFor
        };

        try {
          const sendResult = await dispatchNotification(notif);
          if (sendResult.success) {
            await updateReminder(due.id, {
              status: "SENT",
              sentAt: sendResult.deliveredAt || new Date().toISOString()
            });
            result.remindersSent++;
          } else {
            await updateReminder(due.id, {
              status: "FAILED"
            });
            result.errors.push(`Failed to send reminder ${due.id}: ${sendResult.error}`);
          }
        } catch (err: any) {
          await updateReminder(due.id, { status: "FAILED" });
          result.errors.push(`Error dispatching reminder ${due.id}: ${err.message}`);
        }
      }
    }

    const currentScheduled = await getAllReminders({ status: "SCHEDULED" });
    result.activeRemindersCount = currentScheduled.length;
  } catch (err: any) {
    result.errors.push(err.message || "Unknown error generating reminders.");
  }

  return result;
}

/**
 * Generate structured Morning Briefing data
 */
export async function generateMorningBriefing(
  date: Date = new Date(),
  timezone: string = "Asia/Kolkata"
): Promise<MorningBriefingData> {
  const events = await getAllAcademicEvents();

  // Target reference dates in Asia/Kolkata
  const todayStr = toLocalDateString(date);

  const tomorrowDate = new Date(date);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = toLocalDateString(tomorrowDate);

  const in7DaysDate = new Date(date);
  in7DaysDate.setDate(in7DaysDate.getDate() + 7);
  const in7DaysStr = toLocalDateString(in7DaysDate);

  const todayItems: AcademicItem[] = [];
  const tomorrowItems: AcademicItem[] = [];
  const upcomingItems: AcademicItem[] = [];
  const needsConfirmationItems: AcademicItem[] = [];
  const overdueItems: AcademicItem[] = [];

  for (const item of events) {
    // Exclude CANCELLED and COMPLETED
    if (item.status === "CANCELLED" || item.status === "COMPLETED" || item.status === "SUBMITTED") {
      continue;
    }

    // Overdue check
    if (isEventOverdue(item, date)) {
      overdueItems.push(item);
      continue;
    }

    // Needs confirmation check
    if (item.needsConfirmation) {
      needsConfirmationItems.push(item);
    }

    // Target date resolution
    const target = getEventTargetDate(item);
    if (!target) continue;

    const targetDateStr = toLocalDateString(target);

    if (targetDateStr === todayStr) {
      todayItems.push(item);
    } else if (targetDateStr === tomorrowStr) {
      tomorrowItems.push(item);
    } else if (targetDateStr > tomorrowStr && targetDateStr <= in7DaysStr) {
      upcomingItems.push(item);
    }
  }

  const summary = `${todayItems.length} due today, ${tomorrowItems.length} tomorrow, ${upcomingItems.length} upcoming, ${overdueItems.length} overdue`;

  const briefingData: MorningBriefingData = {
    date: todayStr,
    timezone,
    today: todayItems,
    tomorrow: tomorrowItems,
    upcoming: upcomingItems,
    needsConfirmation: needsConfirmationItems,
    overdue: overdueItems,
    summary,
    rawText: ""
  };

  briefingData.rawText = formatMorningBriefingText(briefingData);
  return briefingData;
}
