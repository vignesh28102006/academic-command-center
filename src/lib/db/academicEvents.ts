import { getSupabaseClient } from "./supabase";
import { AcademicItem, ChangeRecord } from "../types";
import { getChangeHistoryByEventId, recordChangeHistory } from "./changeHistory";

// In-memory store when Supabase is not yet connected
const inMemoryEvents: Map<string, AcademicItem> = new Map();

// Initialize in-memory store with demo items so initial setup has data
function initializeInMemoryIfEmpty() {
  if (inMemoryEvents.size > 0) return;

  const demo1: AcademicItem = {
    id: "demo-lab-1",
    title: "NLP Lab Practice Question",
    subject: "NLP",
    type: "LAB",
    status: "NOT_STARTED",
    deadline: "2026-09-25T11:35:00",
    submissionUrl: "https://classroom.google.com",
    resourceUrls: [],
    attachmentNames: ["Lab2_Practice_Questions.ipynb"],
    description: "Students can practice the lab2 practice question and upload the document before 11:35 am.",
    sourceGroup: "NLP Lab",
    sourceSender: "Faculty Coordinator",
    originalMessages: [
      "Students can practice the lab2 practice question and upload the document before 11:35 am. Submit here: https://classroom.google.com"
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  };

  const demo2: AcademicItem = {
    id: "demo-exam-1",
    title: "Slip Test 2",
    subject: "NLP",
    type: "SLIP_TEST",
    status: "INBOX",
    eventDate: "2026-09-30",
    eventTime: "First hour",
    resourceUrls: [],
    attachmentNames: [],
    description: "Slip test 2 will be conducted on 30-09-2026 during the first hour.",
    sourceGroup: "NLP",
    sourceSender: "Course Lead",
    originalMessages: [
      "Slip test 2 will be conducted on 30-09-2026 during the first hour."
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  };

  inMemoryEvents.set(demo1.id, demo1);
  inMemoryEvents.set(demo2.id, demo2);
}

function mapRowToAcademicItem(row: any, history: ChangeRecord[] = []): AcademicItem {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    type: row.type,
    status: row.status,
    eventDate: row.event_date ? String(row.event_date).slice(0, 10) : undefined,
    eventTime: row.event_time || undefined,
    deadline: row.deadline || undefined,
    deadlineTime: row.deadline_time || undefined,
    submissionUrl: row.submission_url || undefined,
    resourceUrls: Array.isArray(row.resource_urls) ? row.resource_urls : [],
    attachmentNames: Array.isArray(row.attachment_names) ? row.attachment_names : [],
    description: row.description || "",
    requirements: Array.isArray(row.requirements) ? row.requirements : [],
    sourceGroup: row.source_group || undefined,
    sourceSender: row.source_sender || undefined,
    originalMessages: Array.isArray(row.original_messages) ? row.original_messages : [],
    sourceKey: row.source_key || undefined,
    notionPageId: row.notion_page_id || undefined,
    needsConfirmation: Boolean(row.needs_confirmation),
    confidence: row.confidence >= 0.9 ? "HIGH" : row.confidence >= 0.7 ? "MEDIUM" : "NEEDS_CONFIRMATION",
    confidenceScore: row.confidence ?? 0.8,
    lastSyncedAt: row.last_synced_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    changeHistory: history
  };
}

export async function getAllAcademicEvents(filters?: {
  status?: string;
  type?: string;
  subject?: string;
  search?: string;
}): Promise<AcademicItem[]> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    initializeInMemoryIfEmpty();
    let list = Array.from(inMemoryEvents.values());
    if (filters?.status && filters.status !== "ALL") {
      list = list.filter(i => i.status === filters.status);
    }
    if (filters?.type && filters.type !== "ALL") {
      list = list.filter(i => i.type === filters.type);
    }
    if (filters?.subject && filters.subject !== "ALL") {
      list = list.filter(i => i.subject === filters.subject);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    }
    return list;
  }

  let query = supabase.from("academic_events").select("*").order("created_at", { ascending: false });

  if (filters?.status && filters.status !== "ALL") {
    query = query.eq("status", filters.status);
  }
  if (filters?.type && filters.type !== "ALL") {
    query = query.eq("type", filters.type);
  }
  if (filters?.subject && filters.subject !== "ALL") {
    query = query.eq("subject", filters.subject);
  }
  if (filters?.search) {
    query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;

  if (error || !data) {
    console.warn("Supabase query error, fallback to in-memory:", error?.message);
    initializeInMemoryIfEmpty();
    return Array.from(inMemoryEvents.values());
  }

  // Fetch change histories in parallel
  const items = await Promise.all(
    data.map(async row => {
      const history = await getChangeHistoryByEventId(row.id);
      return mapRowToAcademicItem(row, history);
    })
  );

  return items;
}

export async function getAcademicEventById(id: string): Promise<AcademicItem | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    initializeInMemoryIfEmpty();
    return inMemoryEvents.get(id) || null;
  }

  const { data, error } = await supabase
    .from("academic_events")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return inMemoryEvents.get(id) || null;
  }

  const history = await getChangeHistoryByEventId(id);
  return mapRowToAcademicItem(data, history);
}

export async function createAcademicEvent(item: AcademicItem): Promise<AcademicItem> {
  const supabase = getSupabaseClient();
  const id = item.id || crypto.randomUUID();
  const now = new Date().toISOString();

  const record: AcademicItem = {
    ...item,
    id,
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
    changeHistory: item.changeHistory || []
  };

  inMemoryEvents.set(id, record);

  // Record any initial change records if present
  if (record.changeHistory && record.changeHistory.length > 0) {
    for (const ch of record.changeHistory) {
      await recordChangeHistory({ ...ch, eventId: record.id });
    }
  }

  if (!supabase) {
    return record;
  }

  const { data, error } = await supabase
    .from("academic_events")
    .insert({
      id: record.id,
      title: record.title,
      subject: record.subject,
      type: record.type,
      status: record.status,
      event_date: record.eventDate || null,
      event_time: record.eventTime || null,
      deadline: record.deadline || null,
      deadline_time: record.deadlineTime || null,
      submission_url: record.submissionUrl || null,
      resource_urls: record.resourceUrls || [],
      attachment_names: record.attachmentNames || [],
      description: record.description || null,
      requirements: record.requirements || [],
      source_group: record.sourceGroup || null,
      source_sender: record.sourceSender || null,
      original_messages: record.originalMessages || [],
      source_key: record.sourceKey || null,
      notion_page_id: record.notionPageId || null,
      needs_confirmation: Boolean(record.needsConfirmation),
      confidence: record.confidenceScore ?? (record.confidence === "HIGH" ? 0.95 : record.confidence === "MEDIUM" ? 0.75 : 0.5),
      last_synced_at: record.lastSyncedAt || null,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    })
    .select()
    .single();

  if (error) {
    console.warn("Supabase createAcademicEvent error, stored in-memory:", error.message);
    return record;
  }

  return mapRowToAcademicItem(data, record.changeHistory);
}

export async function updateAcademicEvent(
  id: string,
  updates: Partial<AcademicItem>,
  newChanges?: ChangeRecord[]
): Promise<AcademicItem | null> {
  const existing = await getAcademicEventById(id);
  if (!existing) return null;

  // Persist new change records to change_history table & in-memory history
  if (newChanges && newChanges.length > 0) {
    for (const ch of newChanges) {
      await recordChangeHistory({ ...ch, eventId: id });
    }
  }

  const now = new Date().toISOString();
  const updatedItem: AcademicItem = {
    ...existing,
    ...updates,
    id,
    updatedAt: now,
    changeHistory: [...existing.changeHistory, ...(newChanges || [])]
  };

  inMemoryEvents.set(id, updatedItem);

  const supabase = getSupabaseClient();
  if (!supabase) {
    return updatedItem;
  }

  const updatePayload: any = {
    updated_at: now
  };

  if (updates.title !== undefined) updatePayload.title = updates.title;
  if (updates.subject !== undefined) updatePayload.subject = updates.subject;
  if (updates.type !== undefined) updatePayload.type = updates.type;
  if (updates.status !== undefined) updatePayload.status = updates.status;
  if (updates.eventDate !== undefined) updatePayload.event_date = updates.eventDate;
  if (updates.eventTime !== undefined) updatePayload.event_time = updates.eventTime;
  if (updates.deadline !== undefined) updatePayload.deadline = updates.deadline;
  if (updates.deadlineTime !== undefined) updatePayload.deadline_time = updates.deadlineTime;
  if (updates.submissionUrl !== undefined) updatePayload.submission_url = updates.submissionUrl;
  if (updates.resourceUrls !== undefined) updatePayload.resource_urls = updates.resourceUrls;
  if (updates.attachmentNames !== undefined) updatePayload.attachment_names = updates.attachmentNames;
  if (updates.description !== undefined) updatePayload.description = updates.description;
  if (updates.requirements !== undefined) updatePayload.requirements = updates.requirements;
  if (updates.originalMessages !== undefined) updatePayload.original_messages = updates.originalMessages;
  if (updates.notionPageId !== undefined) updatePayload.notion_page_id = updates.notionPageId;
  if (updates.needsConfirmation !== undefined) updatePayload.needs_confirmation = updates.needsConfirmation;
  if (updates.lastSyncedAt !== undefined) updatePayload.last_synced_at = updates.lastSyncedAt;

  const { data, error } = await supabase
    .from("academic_events")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.warn("Supabase updateAcademicEvent error, updated in-memory:", error.message);
  }

  const latestHistory = await getChangeHistoryByEventId(id);
  return mapRowToAcademicItem(data || updatedItem, latestHistory.length > 0 ? latestHistory : updatedItem.changeHistory);
}

export async function deleteAcademicEvent(id: string): Promise<boolean> {
  inMemoryEvents.delete(id);
  const supabase = getSupabaseClient();
  if (!supabase) return true;

  const { error } = await supabase.from("academic_events").delete().eq("id", id);
  return !error;
}

export async function updateEventNotionPageId(id: string, notionPageId: string): Promise<void> {
  const item = inMemoryEvents.get(id);
  if (item) {
    item.notionPageId = notionPageId;
    item.lastSyncedAt = new Date().toISOString();
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase.from("academic_events").update({
      notion_page_id: notionPageId,
      last_synced_at: new Date().toISOString()
    }).eq("id", id);
  }
}
