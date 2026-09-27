import { getSupabaseClient } from "./supabase";
import { ReminderItem, ReminderSettings, ReminderStatus } from "../reminders/reminderTypes";

// Default reminder settings
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  id: "default",
  enabled: true,
  morning_briefing_enabled: true,
  morning_briefing_time: "07:30",
  timezone: "Asia/Kolkata",
  deadline_reminders_enabled: true,
  exam_reminders_enabled: true,
  default_reminder_intervals: ["7d", "3d", "1d", "3h", "1h"],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

// In-memory fallback stores when Supabase is not connected
const globalStore = globalThis as unknown as {
  __inMemoryReminders?: Map<string, ReminderItem>;
  __inMemoryReminderSettings?: ReminderSettings;
};

if (!globalStore.__inMemoryReminders) {
  globalStore.__inMemoryReminders = new Map();
}
if (!globalStore.__inMemoryReminderSettings) {
  globalStore.__inMemoryReminderSettings = { ...DEFAULT_REMINDER_SETTINGS };
}

const inMemoryReminders: Map<string, ReminderItem> = globalStore.__inMemoryReminders;

export function clearInMemoryReminders() {
  inMemoryReminders.clear();
  globalStore.__inMemoryReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, updated_at: new Date().toISOString() };
}

function mapRowToReminderItem(row: any): ReminderItem {
  return {
    id: row.id,
    eventId: row.event_id,
    reminderType: row.reminder_type,
    scheduledFor: typeof row.scheduled_for === "string" ? row.scheduled_for : new Date(row.scheduled_for).toISOString(),
    sentAt: row.sent_at ? (typeof row.sent_at === "string" ? row.sent_at : new Date(row.sent_at).toISOString()) : null,
    status: row.status as ReminderStatus,
    notificationChannel: row.notification_channel || "CONSOLE",
    message: row.message,
    eventVersion: row.event_version ? Number(row.event_version) : 1,
    priority: row.priority || "NORMAL",
    submissionUrl: row.submission_url || undefined,
    dedupKey: row.dedup_key || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRowToSettings(row: any): ReminderSettings {
  return {
    id: row.id || "default",
    enabled: Boolean(row.enabled),
    morning_briefing_enabled: Boolean(row.morning_briefing_enabled),
    morning_briefing_time: row.morning_briefing_time || "07:30",
    timezone: row.timezone || "Asia/Kolkata",
    deadline_reminders_enabled: Boolean(row.deadline_reminders_enabled),
    exam_reminders_enabled: Boolean(row.exam_reminders_enabled),
    default_reminder_intervals: Array.isArray(row.default_reminder_intervals)
      ? row.default_reminder_intervals
      : ["7d", "3d", "1d", "3h", "1h"],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// -----------------------------------------------------------------------------
// SETTINGS OPERATIONS
// -----------------------------------------------------------------------------
export async function getReminderSettings(): Promise<ReminderSettings> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ...(globalStore.__inMemoryReminderSettings || DEFAULT_REMINDER_SETTINGS) };
  }

  const { data, error } = await supabase
    .from("reminder_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  if (error || !data) {
    return { ...(globalStore.__inMemoryReminderSettings || DEFAULT_REMINDER_SETTINGS) };
  }

  return mapRowToSettings(data);
}

export async function updateReminderSettings(
  updates: Partial<Omit<ReminderSettings, "id" | "created_at">>
): Promise<ReminderSettings> {
  const now = new Date().toISOString();
  globalStore.__inMemoryReminderSettings = {
    ...(globalStore.__inMemoryReminderSettings || DEFAULT_REMINDER_SETTINGS),
    ...updates,
    updated_at: now
  };

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ...globalStore.__inMemoryReminderSettings };
  }

  const payload: any = {
    updated_at: now
  };

  if (updates.enabled !== undefined) payload.enabled = updates.enabled;
  if (updates.morning_briefing_enabled !== undefined) payload.morning_briefing_enabled = updates.morning_briefing_enabled;
  if (updates.morning_briefing_time !== undefined) payload.morning_briefing_time = updates.morning_briefing_time;
  if (updates.timezone !== undefined) payload.timezone = updates.timezone;
  if (updates.deadline_reminders_enabled !== undefined) payload.deadline_reminders_enabled = updates.deadline_reminders_enabled;
  if (updates.exam_reminders_enabled !== undefined) payload.exam_reminders_enabled = updates.exam_reminders_enabled;
  if (updates.default_reminder_intervals !== undefined) payload.default_reminder_intervals = updates.default_reminder_intervals;

  const { data, error } = await supabase
    .from("reminder_settings")
    .upsert({
      id: "default",
      ...payload
    })
    .select()
    .single();

  if (error || !data) {
    console.warn("Supabase updateReminderSettings error, stored in-memory:", error?.message);
    return { ...(globalStore.__inMemoryReminderSettings || DEFAULT_REMINDER_SETTINGS) };
  }

  return mapRowToSettings(data);
}

// -----------------------------------------------------------------------------
// REMINDERS OPERATIONS
// -----------------------------------------------------------------------------
export async function getAllReminders(filters?: {
  status?: string;
  eventId?: string;
  limit?: number;
}): Promise<ReminderItem[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    let list = Array.from(inMemoryReminders.values());
    if (filters?.status && filters.status !== "ALL") {
      list = list.filter(r => r.status === filters.status);
    }
    if (filters?.eventId) {
      list = list.filter(r => r.eventId === filters.eventId);
    }
    list.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    if (filters?.limit) {
      list = list.slice(0, filters.limit);
    }
    return list;
  }

  let query = supabase
    .from("reminders")
    .select("*")
    .order("scheduled_for", { ascending: true });

  if (filters?.status && filters.status !== "ALL") {
    query = query.eq("status", filters.status);
  }
  if (filters?.eventId) {
    query = query.eq("event_id", filters.eventId);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error || !data) {
    let list = Array.from(inMemoryReminders.values());
    if (filters?.status && filters.status !== "ALL") {
      list = list.filter(r => r.status === filters.status);
    }
    if (filters?.eventId) {
      list = list.filter(r => r.eventId === filters.eventId);
    }
    list.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    return filters?.limit ? list.slice(0, filters.limit) : list;
  }

  return data.map(mapRowToReminderItem);
}

export async function getRemindersByEventId(eventId: string): Promise<ReminderItem[]> {
  return getAllReminders({ eventId });
}

export async function createReminder(reminder: Omit<ReminderItem, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<ReminderItem | null> {
  const dedupKey = reminder.dedupKey ||
    `${reminder.eventId}_v${reminder.eventVersion}_${reminder.reminderType}_${reminder.scheduledFor}`;

  // Deduplication check
  for (const item of Array.from(inMemoryReminders.values())) {
    if (item.dedupKey === dedupKey) {
      return item; // Already exists, return existing
    }
  }

  const id = reminder.id || crypto.randomUUID();
  const now = new Date().toISOString();

  const record: ReminderItem = {
    ...reminder,
    id,
    dedupKey,
    createdAt: now,
    updatedAt: now
  };

  inMemoryReminders.set(id, record);

  const supabase = getSupabaseClient();
  if (!supabase) {
    return record;
  }

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      id: record.id,
      event_id: record.eventId,
      reminder_type: record.reminderType,
      scheduled_for: record.scheduledFor,
      sent_at: record.sentAt || null,
      status: record.status,
      notification_channel: record.notificationChannel,
      message: record.message,
      event_version: record.eventVersion,
      priority: record.priority || "NORMAL",
      submission_url: record.submissionUrl || null,
      dedup_key: record.dedupKey,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    })
    .select()
    .single();

  if (error) {
    // If unique constraint violation, fetch and return the duplicate
    if (error.code === "23505" || error.message.includes("unique")) {
      const { data: existing } = await supabase
        .from("reminders")
        .select("*")
        .eq("dedup_key", dedupKey)
        .maybeSingle();
      if (existing) return mapRowToReminderItem(existing);
    }
    console.warn("Supabase createReminder error, stored in-memory:", error.message);
    return record;
  }

  return mapRowToReminderItem(data);
}

export async function updateReminder(
  id: string,
  updates: Partial<ReminderItem>
): Promise<ReminderItem | null> {
  const existing = inMemoryReminders.get(id);
  const now = new Date().toISOString();

  if (existing) {
    const updated: ReminderItem = {
      ...existing,
      ...updates,
      id,
      updatedAt: now
    };
    inMemoryReminders.set(id, updated);
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return inMemoryReminders.get(id) || null;
  }

  const payload: any = {
    updated_at: now
  };

  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.sentAt !== undefined) payload.sent_at = updates.sentAt;
  if (updates.message !== undefined) payload.message = updates.message;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.notificationChannel !== undefined) payload.notification_channel = updates.notificationChannel;

  const { data, error } = await supabase
    .from("reminders")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return inMemoryReminders.get(id) || null;
  }

  return mapRowToReminderItem(data);
}

export async function cancelRemindersForEvent(
  eventId: string,
  reason: string = "Event updated or cancelled",
  onlyScheduled: boolean = true
): Promise<number> {
  let count = 0;
  const now = new Date().toISOString();

  // In-memory update
  for (const [id, item] of Array.from(inMemoryReminders.entries())) {
    if (item.eventId === eventId && (!onlyScheduled || item.status === "SCHEDULED")) {
      item.status = "CANCELLED";
      item.updatedAt = now;
      inMemoryReminders.set(id, item);
      count++;
    }
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return count;
  }

  let query = supabase
    .from("reminders")
    .update({
      status: "CANCELLED",
      updated_at: now
    })
    .eq("event_id", eventId);

  if (onlyScheduled) {
    query = query.eq("status", "SCHEDULED");
  }

  const { data, error } = await query.select();
  if (error) {
    console.warn("Supabase cancelRemindersForEvent error:", error.message);
    return count;
  }

  return data?.length ?? count;
}

export async function getDueReminders(referenceDate: Date = new Date()): Promise<ReminderItem[]> {
  const refIso = referenceDate.toISOString();
  const supabase = getSupabaseClient();

  if (!supabase) {
    const list = Array.from(inMemoryReminders.values()).filter(
      r => r.status === "SCHEDULED" && new Date(r.scheduledFor).getTime() <= referenceDate.getTime()
    );
    list.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    return list;
  }

  const { data, error } = await supabase
    .from("reminders")
    .select("*")
    .eq("status", "SCHEDULED")
    .lte("scheduled_for", refIso)
    .order("scheduled_for", { ascending: true });

  if (error || !data) {
    const list = Array.from(inMemoryReminders.values()).filter(
      r => r.status === "SCHEDULED" && new Date(r.scheduledFor).getTime() <= referenceDate.getTime()
    );
    return list;
  }

  return data.map(mapRowToReminderItem);
}
