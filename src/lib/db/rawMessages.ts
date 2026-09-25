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
    messageTimestamp: now,
    messageHash: hash,
    processedAt: now,
    processingStatus: options?.processingStatus || "PROCESSED",
    linkedEventId: options?.linkedEventId
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
