import crypto from "node:crypto";
import { getSupabaseClient } from "./supabase";
import { RawMessageRecord } from "../types";

// In-memory set for deduplication when Supabase is not connected
const inMemoryProcessedHashes = new Set<string>();
const inMemoryRawMessages: RawMessageRecord[] = [];

/**
 * Compute SHA-256 hash of normalized message text
 */
export function hashMessage(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export async function isMessageProcessed(hash: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return inMemoryProcessedHashes.has(hash);
  }

  const { data, error } = await supabase
    .from("raw_messages")
    .select("id")
    .eq("message_hash", hash)
    .maybeSingle();

  if (error) {
    console.warn("Supabase isMessageProcessed error, checking in-memory:", error.message);
    return inMemoryProcessedHashes.has(hash);
  }

  return Boolean(data);
}

export async function recordRawMessage(
  messageText: string,
  options?: {
    source?: string;
    sourceGroup?: string;
    sourceSender?: string;
    messageTimestamp?: string;
    sourceMessageId?: string;
    processingStatus?: RawMessageRecord["processingStatus"];
    linkedEventId?: string;
  }
): Promise<RawMessageRecord> {
  const hash = hashMessage(messageText);
  const now = new Date().toISOString();
  const supabase = getSupabaseClient();

  const record: RawMessageRecord = {
    id: crypto.randomUUID(),
    source: options?.source || "whatsapp",
    sourceGroup: options?.sourceGroup,
    sourceSender: options?.sourceSender,
    messageText: messageText.trim(),
    messageTimestamp: options?.messageTimestamp || now,
    messageHash: hash,
    processedAt: now,
    processingStatus: options?.processingStatus || "PROCESSED",
    linkedEventId: options?.linkedEventId,
    sourceMessageId: options?.sourceMessageId
  };

  inMemoryProcessedHashes.add(hash);
  inMemoryRawMessages.push(record);

  if (!supabase) {
    return record;
  }

  const { data, error } = await supabase
    .from("raw_messages")
    .insert({
      id: record.id,
      source: record.source,
      source_group: record.sourceGroup,
      source_sender: record.sourceSender,
      message_text: record.messageText,
      message_timestamp: record.messageTimestamp,
      message_hash: record.messageHash,
      processed_at: record.processedAt,
      processing_status: record.processingStatus,
      linked_event_id: record.linkedEventId
    })
    .select()
    .single();

  if (error) {
    console.warn("Supabase recordRawMessage error:", error.message);
    return record;
  }

  return record;
}

export async function getRawMessages(limit: number = 50): Promise<RawMessageRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return inMemoryRawMessages.slice(-limit).reverse();
  }

  const { data, error } = await supabase
    .from("raw_messages")
    .select("*")
    .order("processed_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return inMemoryRawMessages.slice(-limit).reverse();
  }

  return data.map(r => ({
    id: r.id,
    source: r.source,
    sourceGroup: r.source_group,
    sourceSender: r.source_sender,
    messageText: r.message_text,
    messageTimestamp: r.message_timestamp,
    messageHash: r.message_hash,
    processedAt: r.processed_at,
    processingStatus: r.processing_status,
    linkedEventId: r.linked_event_id,
    sourceMessageId: r.source_message_id
  }));
}
