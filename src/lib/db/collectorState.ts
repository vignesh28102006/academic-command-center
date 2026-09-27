import crypto from "node:crypto";
import { getSupabaseClient } from "./supabase";
import { CollectorGroupState, CollectorScanHistory } from "../types";

const inMemoryGroups = new Map<string, CollectorGroupState>();
const inMemoryScans: CollectorScanHistory[] = [];

export const BACKFILL_START_DATE = "2026-09-10T00:00:00+05:30";

export function resetCollectorStateInMemory() {
  inMemoryGroups.clear();
  inMemoryScans.length = 0;
}

function mapRowToGroup(row: any): CollectorGroupState {
  const lastScannedTime = row.last_scanned_message_timestamp || row.last_processed_message_timestamp || null;
  const lastScannedId = row.last_scanned_message_id || row.last_processed_message_id || null;
  const lastProcessedAcademicTime = row.last_processed_academic_message_timestamp || row.last_processed_message_timestamp || null;
  const lastProcessedAcademicId = row.last_processed_academic_message_id || row.last_processed_message_id || null;

  return {
    id: row.id,
    groupName: row.group_name,
    groupIdentifier: row.group_identifier,
    firstBackfillDate: row.first_backfill_date || BACKFILL_START_DATE,
    lastScannedMessageTimestamp: lastScannedTime,
    lastScannedMessageId: lastScannedId,
    lastProcessedAcademicMessageTimestamp: lastProcessedAcademicTime,
    lastProcessedAcademicMessageId: lastProcessedAcademicId,
    // Backward compatibility aliases
    lastProcessedMessageTimestamp: lastProcessedAcademicTime || lastScannedTime,
    lastProcessedMessageId: lastProcessedAcademicId || lastScannedId,
    lastScanTime: row.last_scan_time || null,
    lastSuccessfulScanTime: row.last_successful_scan_time || null,
    backfillComplete: Boolean(row.backfill_complete),
    status: row.status || "IDLE",
    messagesScanned: row.messages_scanned || 0,
    messagesProcessed: row.messages_processed || 0,
    messagesIgnored: row.messages_ignored || 0,
    messagesFailed: row.messages_failed || 0,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRowToScan(row: any): CollectorScanHistory {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    status: row.status || "IN_PROGRESS",
    groupsDiscovered: row.groups_discovered || 0,
    groupsCompleted: row.groups_completed || 0,
    groupsFailed: row.groups_failed || 0,
    messagesScanned: row.messages_scanned || 0,
    messagesProcessed: row.messages_processed || 0,
    messagesIgnored: row.messages_ignored || 0,
    eventsCreated: row.events_created || 0,
    eventsUpdated: row.events_updated || 0,
    error: row.error || null,
    createdAt: row.created_at
  };
}

export async function getOrCreateCollectorGroup(
  groupName: string,
  groupIdentifier?: string
): Promise<CollectorGroupState> {
  const cleanName = groupName.trim();
  const cleanId = (groupIdentifier && groupIdentifier.trim().length > 0)
    ? groupIdentifier.trim()
    : cleanName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  // Check in-memory first
  if (inMemoryGroups.has(cleanId)) {
    return inMemoryGroups.get(cleanId)!;
  }

  if (supabase) {
    const { data } = await supabase
      .from("collector_group_state")
      .select("*")
      .eq("group_identifier", cleanId)
      .maybeSingle();

    if (data) {
      const mapped = mapRowToGroup(data);
      inMemoryGroups.set(cleanId, mapped);
      return mapped;
    }

    const { data: created, error } = await supabase
      .from("collector_group_state")
      .insert({
        group_name: cleanName,
        group_identifier: cleanId,
        first_backfill_date: BACKFILL_START_DATE,
        backfill_complete: false,
        status: "IDLE",
        messages_scanned: 0,
        messages_processed: 0,
        messages_ignored: 0,
        created_at: now,
        updated_at: now
      })
      .select("*")
      .single();

    if (!error && created) {
      const mapped = mapRowToGroup(created);
      inMemoryGroups.set(cleanId, mapped);
      return mapped;
    }
  }

  // Fallback to in-memory
  const newGroup: CollectorGroupState = {
    id: crypto.randomUUID(),
    groupName: cleanName,
    groupIdentifier: cleanId,
    firstBackfillDate: BACKFILL_START_DATE,
    lastScannedMessageTimestamp: null,
    lastScannedMessageId: null,
    lastProcessedAcademicMessageTimestamp: null,
    lastProcessedAcademicMessageId: null,
    lastProcessedMessageTimestamp: null,
    lastProcessedMessageId: null,
    lastScanTime: null,
    lastSuccessfulScanTime: null,
    backfillComplete: false,
    status: "IDLE",
    messagesScanned: 0,
    messagesProcessed: 0,
    messagesIgnored: 0,
    messagesFailed: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };

  inMemoryGroups.set(cleanId, newGroup);
  return newGroup;
}

export async function getAllCollectorGroups(): Promise<CollectorGroupState[]> {
  const supabase = getSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("collector_group_state")
      .select("*")
      .order("group_name", { ascending: true });

    if (!error && data) {
      const list = data.map(mapRowToGroup);
      for (const item of list) {
        inMemoryGroups.set(item.groupIdentifier, item);
      }
      return list;
    }
  }

  return Array.from(inMemoryGroups.values()).sort((a, b) =>
    a.groupName.localeCompare(b.groupName)
  );
}

export async function getCollectorGroupByRef(ref: string): Promise<CollectorGroupState | null> {
  const clean = ref.trim();
  const lower = clean.toLowerCase();

  // Search in memory
  for (const group of Array.from(inMemoryGroups.values())) {
    if (
      group.id === clean ||
      group.groupIdentifier === clean ||
      group.groupIdentifier.toLowerCase() === lower ||
      group.groupName.toLowerCase() === lower
    ) {
      return group;
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    // Search by group_identifier or exact group_name or UUID id safely
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
    
    let query = supabase.from("collector_group_state").select("*");
    if (isUuid) {
      query = query.eq("id", clean);
    } else {
      query = query.or(`group_identifier.eq."${clean}",group_name.ilike."${clean}"`);
    }

    const { data } = await query.maybeSingle();

    if (data) {
      const mapped = mapRowToGroup(data);
      inMemoryGroups.set(mapped.groupIdentifier, mapped);
      return mapped;
    }
  }

  return null;
}

export async function updateCollectorGroupCursor(
  groupIdentifier: string,
  updates: Partial<CollectorGroupState> & {
    messagesScannedIncrement?: number;
    messagesProcessedIncrement?: number;
    messagesIgnoredIncrement?: number;
  }
): Promise<CollectorGroupState> {
  const existing = await getOrCreateCollectorGroup(
    updates.groupName || groupIdentifier,
    groupIdentifier
  );

  const now = new Date().toISOString();
  const merged: CollectorGroupState = {
    ...existing,
    ...updates,
    updatedAt: now
  };

  if (updates.messagesScannedIncrement) {
    merged.messagesScanned = (existing.messagesScanned || 0) + updates.messagesScannedIncrement;
  }
  if (updates.messagesProcessedIncrement) {
    merged.messagesProcessed = (existing.messagesProcessed || 0) + updates.messagesProcessedIncrement;
  }
  if (updates.messagesIgnoredIncrement) {
    merged.messagesIgnored = (existing.messagesIgnored || 0) + updates.messagesIgnoredIncrement;
  }

  // If scan succeeded, update lastSuccessfulScanTime
  if (updates.status === "MONITORING" || updates.backfillComplete) {
    merged.lastSuccessfulScanTime = now;
  }
  if (updates.lastScanTime === undefined) {
    merged.lastScanTime = now;
  }

  inMemoryGroups.set(existing.groupIdentifier, merged);

  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase
      .from("collector_group_state")
      .update({
        group_name: merged.groupName,
        last_scanned_message_timestamp: merged.lastScannedMessageTimestamp || merged.lastProcessedMessageTimestamp,
        last_scanned_message_id: merged.lastScannedMessageId || merged.lastProcessedMessageId,
        last_processed_academic_message_timestamp: merged.lastProcessedAcademicMessageTimestamp || merged.lastProcessedMessageTimestamp,
        last_processed_academic_message_id: merged.lastProcessedAcademicMessageId || merged.lastProcessedMessageId,
        last_processed_message_timestamp: merged.lastProcessedMessageTimestamp || merged.lastScannedMessageTimestamp,
        last_processed_message_id: merged.lastProcessedMessageId || merged.lastScannedMessageId,
        last_scan_time: merged.lastScanTime,
        last_successful_scan_time: merged.lastSuccessfulScanTime,
        backfill_complete: merged.backfillComplete,
        status: merged.status,
        messages_scanned: merged.messagesScanned,
        messages_processed: merged.messagesProcessed,
        messages_ignored: merged.messagesIgnored,
        messages_failed: merged.messagesFailed || 0,
        last_error: merged.lastError,
        updated_at: now
      })
      .eq("group_identifier", existing.groupIdentifier);
  }

  return merged;
}

/**
 * Development / Admin function: Reset a group's backfill state.
 * Clears the saved cursors and sets backfill_complete = false,
 * allowing the collector to scan from September 10, 2026 again.
 */
export async function resetCollectorGroupBackfill(ref: string): Promise<CollectorGroupState | null> {
  const existing = await getCollectorGroupByRef(ref);
  if (!existing) return null;

  const now = new Date().toISOString();
  const resetGroup: CollectorGroupState = {
    ...existing,
    lastScannedMessageTimestamp: null,
    lastScannedMessageId: null,
    lastProcessedAcademicMessageTimestamp: null,
    lastProcessedAcademicMessageId: null,
    lastProcessedMessageTimestamp: null,
    lastProcessedMessageId: null,
    backfillComplete: false,
    status: "IDLE",
    lastError: null,
    updatedAt: now
  };

  inMemoryGroups.set(existing.groupIdentifier, resetGroup);

  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase
      .from("collector_group_state")
      .update({
        last_scanned_message_timestamp: null,
        last_scanned_message_id: null,
        last_processed_academic_message_timestamp: null,
        last_processed_academic_message_id: null,
        last_processed_message_timestamp: null,
        last_processed_message_id: null,
        backfill_complete: false,
        status: "IDLE",
        last_error: null,
        updated_at: now
      })
      .eq("group_identifier", existing.groupIdentifier);
  }

  return resetGroup;
}

export async function createScanRecord(
  initial?: Partial<CollectorScanHistory>
): Promise<CollectorScanHistory> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const scan: CollectorScanHistory = {
    id,
    startedAt: initial?.startedAt || now,
    completedAt: initial?.completedAt || null,
    status: initial?.status || "IN_PROGRESS",
    groupsDiscovered: initial?.groupsDiscovered || 0,
    groupsCompleted: initial?.groupsCompleted || 0,
    groupsFailed: initial?.groupsFailed || 0,
    messagesScanned: initial?.messagesScanned || 0,
    messagesProcessed: initial?.messagesProcessed || 0,
    messagesIgnored: initial?.messagesIgnored || 0,
    eventsCreated: initial?.eventsCreated || 0,
    eventsUpdated: initial?.eventsUpdated || 0,
    error: initial?.error || null,
    createdAt: now
  };

  inMemoryScans.unshift(scan);
  if (inMemoryScans.length > 50) {
    inMemoryScans.pop();
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase.from("collector_scan_history").insert({
      id: scan.id,
      started_at: scan.startedAt,
      completed_at: scan.completedAt,
      status: scan.status,
      groups_discovered: scan.groupsDiscovered,
      groups_completed: scan.groupsCompleted,
      groups_failed: scan.groupsFailed,
      messages_scanned: scan.messagesScanned,
      messages_processed: scan.messagesProcessed,
      messages_ignored: scan.messagesIgnored,
      events_created: scan.eventsCreated,
      events_updated: scan.eventsUpdated,
      error: scan.error,
      created_at: scan.createdAt
    });
  }

  return scan;
}

export async function updateScanRecord(
  id: string,
  updates: Partial<CollectorScanHistory>
): Promise<CollectorScanHistory | null> {
  const index = inMemoryScans.findIndex(s => s.id === id);
  if (index >= 0) {
    inMemoryScans[index] = {
      ...inMemoryScans[index],
      ...updates
    };
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase
      .from("collector_scan_history")
      .update({
        completed_at: updates.completedAt,
        status: updates.status,
        groups_discovered: updates.groupsDiscovered,
        groups_completed: updates.groupsCompleted,
        groups_failed: updates.groupsFailed,
        messages_scanned: updates.messagesScanned,
        messages_processed: updates.messagesProcessed,
        messages_ignored: updates.messagesIgnored,
        events_created: updates.eventsCreated,
        events_updated: updates.eventsUpdated,
        error: updates.error
      })
      .eq("id", id);
  }

  return index >= 0 ? inMemoryScans[index] : null;
}

export async function getRecentScans(limit: number = 10): Promise<CollectorScanHistory[]> {
  const supabase = getSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("collector_scan_history")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(limit);

    if (!error && data) {
      return data.map(mapRowToScan);
    }
  }

  return inMemoryScans.slice(0, limit);
}
