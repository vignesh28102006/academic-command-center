import { getReminderSettings, getAllReminders } from "../db/reminders";
import { generateReminders, generateMorningBriefing } from "./reminderEngine";
import { ReminderSettings } from "./reminderTypes";
import { pad2 } from "../dateUtils";

export interface SchedulerStatus {
  enabled: boolean;
  nextReminderTimestamp: string | null;
  nextMorningBriefingTimestamp: string;
  activeRemindersCount: number;
  timezone: string;
  schedulerIntervalMs: number;
}

/**
 * Compute the next Morning Briefing run time in the configured timezone (default 07:30 Asia/Kolkata)
 */
export function getNextMorningBriefingRun(
  referenceDate: Date = new Date(),
  settings?: ReminderSettings
): Date {
  const briefingTime = settings?.morning_briefing_time || "07:30";
  const [bHours, bMinutes] = briefingTime.split(":").map(Number);

  // In Asia/Kolkata (+05:30)
  // Compute target for today
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1;
  const day = referenceDate.getDate();

  const todayTargetIso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(bHours)}:${pad2(bMinutes)}:00+05:30`;
  const todayTarget = new Date(todayTargetIso);

  if (todayTarget.getTime() > referenceDate.getTime()) {
    return todayTarget;
  }

  // Otherwise, target is tomorrow at same time
  const tomorrow = new Date(referenceDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tYear = tomorrow.getFullYear();
  const tMonth = tomorrow.getMonth() + 1;
  const tDay = tomorrow.getDate();

  const tomorrowTargetIso = `${tYear}-${pad2(tMonth)}-${pad2(tDay)}T${pad2(bHours)}:${pad2(bMinutes)}:00+05:30`;
  return new Date(tomorrowTargetIso);
}

/**
 * Get overall scheduler status for Dashboard / Telemetry
 */
export async function getSchedulerStatus(referenceDate: Date = new Date()): Promise<SchedulerStatus> {
  const settings = await getReminderSettings();
  const upcomingScheduled = await getAllReminders({ status: "SCHEDULED" });

  // Filter to find the earliest scheduled_for >= referenceDate
  const futureReminders = upcomingScheduled.filter(
    r => new Date(r.scheduledFor).getTime() >= referenceDate.getTime()
  );

  const nextReminder = futureReminders.length > 0 ? futureReminders[0].scheduledFor : null;
  const nextBriefing = getNextMorningBriefingRun(referenceDate, settings).toISOString();

  const intervalMs = process.env.REMINDER_SCHEDULER_INTERVAL_MS
    ? parseInt(process.env.REMINDER_SCHEDULER_INTERVAL_MS, 10)
    : 60 * 1000;

  return {
    enabled: settings.enabled,
    nextReminderTimestamp: nextReminder,
    nextMorningBriefingTimestamp: nextBriefing,
    activeRemindersCount: upcomingScheduled.length,
    timezone: settings.timezone || "Asia/Kolkata",
    schedulerIntervalMs: intervalMs
  };
}

/**
 * Execute a single scheduler cycle tick
 * Serverless / Cron compatible entry point.
 */
export async function runSchedulerTick(referenceDate: Date = new Date()) {
  const settings = await getReminderSettings();
  if (!settings.enabled) {
    return {
      status: "SKIPPED",
      reason: "Reminder system is disabled in settings."
    };
  }

  const result = await generateReminders(referenceDate, true);
  return {
    status: "COMPLETED",
    result
  };
}
