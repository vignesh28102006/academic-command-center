import { AcademicItem } from "../types";

export type ReminderType =
  | "7d"
  | "3d"
  | "1d"
  | "3h"
  | "1h"
  | "OVERDUE"
  | "CONFIRMATION_NEEDED"
  | "TEST";

export type ReminderStatus =
  | "SCHEDULED"
  | "SENT"
  | "CANCELLED"
  | "FAILED"
  | "SKIPPED";

export type NotificationChannel =
  | "CONSOLE"
  | "BROWSER"
  | "EMAIL"
  | "WINDOWS"
  | "MOBILE";

export type ReminderPriority =
  | "URGENT"
  | "HIGH"
  | "REVIEW"
  | "NORMAL";

export interface ReminderSettings {
  id: string;
  enabled: boolean;
  morning_briefing_enabled: boolean;
  morning_briefing_time: string; // e.g. "07:30"
  timezone: string; // default: "Asia/Kolkata"
  deadline_reminders_enabled: boolean;
  exam_reminders_enabled: boolean;
  default_reminder_intervals: string[]; // ["7d", "3d", "1d", "3h", "1h"]
  created_at: string;
  updated_at: string;
}

export interface ReminderItem {
  id: string;
  eventId: string;
  reminderType: ReminderType;
  scheduledFor: string; // ISO string (e.g. 2026-09-29T10:00:00.000Z)
  sentAt?: string | null;
  status: ReminderStatus;
  notificationChannel: NotificationChannel;
  message: string;
  eventVersion: number;
  priority?: ReminderPriority;
  submissionUrl?: string;
  dedupKey?: string;
  eventTitle?: string;
  eventSubject?: string;
  eventType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderNotification {
  id: string;
  reminderId?: string;
  eventId?: string;
  title: string;
  body: string;
  channel: NotificationChannel;
  priority: ReminderPriority;
  submissionUrl?: string;
  scheduledFor: string;
  metadata?: Record<string, any>;
}

export interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  deliveredAt?: string;
  error?: string;
}

export interface NotificationProvider {
  name: string;
  channel: NotificationChannel;
  isAvailable(): boolean;
  send(notification: ReminderNotification): Promise<NotificationResult>;
}

export interface MorningBriefingData {
  date: string; // YYYY-MM-DD
  timezone: string;
  today: AcademicItem[];
  tomorrow: AcademicItem[];
  upcoming: AcademicItem[];
  needsConfirmation: AcademicItem[];
  overdue: AcademicItem[];
  summary: string;
  rawText: string;
}

export interface GenerateRemindersResult {
  scannedEvents: number;
  remindersCreated: number;
  remindersCancelled: number;
  remindersSent: number;
  activeRemindersCount: number;
  errors: string[];
}
