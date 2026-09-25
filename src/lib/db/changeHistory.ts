import { getSupabaseClient } from "./supabase";
import { ChangeRecord } from "../types";

// In-memory fallback cache when Supabase is not yet connected
const inMemoryHistory: ChangeRecord[] = [];

export async function recordChangeHistory(record: ChangeRecord): Promise<ChangeRecord> {
  const supabase = getSupabaseClient();
  const entry: ChangeRecord = {
    ...record,
    id: record.id || crypto.randomUUID(),
    timestamp: record.timestamp || new Date().toISOString()
  };

  if (!supabase) {
    inMemoryHistory.push(entry);
    return entry;
  }

  const { data, error } = await supabase
    .from("change_history")
    .insert({
      id: entry.id,
      event_id: entry.eventId,
      timestamp: entry.timestamp,
      field_changed: entry.field,
      old_value: entry.oldValue ? String(entry.oldValue) : null,
      new_value: entry.newValue ? String(entry.newValue) : null,
      summary: entry.summary,
      source_message_id: entry.sourceMessageId || entry.sourceMessage || null
    })
    .select()
    .single();

  if (error) {
    console.warn("Supabase recordChangeHistory error, cached in-memory:", error.message);
    inMemoryHistory.push(entry);
    return entry;
  }

  return entry;
}

export async function getChangeHistoryByEventId(eventId: string): Promise<ChangeRecord[]> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return inMemoryHistory.filter(h => h.eventId === eventId);
  }

  const { data, error } = await supabase
    .from("change_history")
    .select("*")
    .eq("event_id", eventId)
    .order("timestamp", { ascending: true });

  if (error) {
    console.warn("Supabase getChangeHistoryByEventId error:", error.message);
    return inMemoryHistory.filter(h => h.eventId === eventId);
  }

  return (data || []).map(row => ({
    id: row.id,
    eventId: row.event_id,
    timestamp: row.timestamp,
    field: row.field_changed,
    oldValue: row.old_value,
    newValue: row.new_value,
    summary: row.summary,
    sourceMessageId: row.source_message_id
  }));
}
