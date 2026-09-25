import { processAcademicMessageWithAI } from "../events";
import {
  getAllAcademicEvents,
  createAcademicEvent,
  updateAcademicEvent
} from "../db/academicEvents";
import { hashMessage, isMessageProcessed, recordRawMessage } from "../db/rawMessages";
import { resolveSubjectCode } from "../db/subjectMappings";
import { syncEventToNotion } from "../notion/sync";
import { AcademicItem } from "../types";

export interface ProcessMessageInput {
  message: string;
  source?: string;
  sourceGroup?: string;
  sourceSender?: string;
  messageTimestamp?: string;
  sourceMessageId?: string;
}

export interface ProcessMessageResult {
  action: "CREATED" | "UPDATED" | "IGNORED_DUPLICATE" | "NON_ACADEMIC";
  item?: AcademicItem;
  reason?: string;
  changeSummary?: string;
  beforeAfter?: any;
  notionSync?: {
    status: "CREATED" | "UPDATED" | "FAILED" | "SKIPPED";
    notionPageId?: string;
    error?: string;
  };
  aiExtraction?: any;
  providerUsed?: string;
  confidence?: string;
}

export async function processAcademicMessagePipeline(
  input: ProcessMessageInput
): Promise<ProcessMessageResult> {
  const rawMessage = input.message.trim();
  const source = input.source || "WHATSAPP_WEB";
  const sourceGroup = input.sourceGroup?.trim();
  const sourceSender = input.sourceSender?.trim();
  const messageTimestamp = input.messageTimestamp?.trim();
  const sourceMessageId = input.sourceMessageId?.trim();

  // 1. Message Hash Deduplication Check
  const messageHash = hashMessage(rawMessage);
  const alreadyProcessed = await isMessageProcessed(messageHash);
  if (alreadyProcessed) {
    return {
      action: "IGNORED_DUPLICATE",
      reason: "Exact message already processed and recorded in message store."
    };
  }

  // 2. Fetch current active academic events from Supabase (Source of Truth)
  const existingEvents = await getAllAcademicEvents();

  // 3. Check Subject Mappings for course code translation (e.g. 19CSE312 -> NLP)
  const mappedSubject = await resolveSubjectCode(rawMessage) ||
    (sourceGroup ? await resolveSubjectCode(sourceGroup) : null);

  // 4. Run AI Parser & Event Intelligence Engine
  const parsingResult = await processAcademicMessageWithAI(
    rawMessage,
    existingEvents,
    {
      sourceGroup,
      sourceSender,
      timezone: "Asia/Kolkata"
    }
  );

  // 5. Handle Non-Academic Chatter
  if (parsingResult.action === "NON_ACADEMIC") {
    await recordRawMessage(rawMessage, {
      source,
      sourceGroup,
      sourceSender,
      messageTimestamp,
      sourceMessageId,
      processingStatus: "NON_ACADEMIC"
    });

    return {
      action: "NON_ACADEMIC",
      reason: parsingResult.reason || "Filtered as non-academic chatter.",
      aiExtraction: parsingResult.aiExtraction,
      providerUsed: parsingResult.providerUsed
    };
  }

  // 6. Handle Duplicate Detection from Event Engine
  if (parsingResult.action === "IGNORED_DUPLICATE") {
    await recordRawMessage(rawMessage, {
      source,
      sourceGroup,
      sourceSender,
      messageTimestamp,
      sourceMessageId,
      processingStatus: "IGNORED_DUPLICATE",
      linkedEventId: parsingResult.updatedItemId
    });

    return {
      action: "IGNORED_DUPLICATE",
      reason: parsingResult.reason || "Duplicate message detected.",
      item: parsingResult.item
    };
  }

  // 7. Handle Modification to Existing Event (Supabase Update + Notion Sync)
  if (parsingResult.action === "UPDATED" && parsingResult.item) {
    const targetId = parsingResult.updatedItemId || parsingResult.item.id;
    const latestChanges = parsingResult.item.changeHistory.slice(-3);

    // Persist in Supabase
    const updated = await updateAcademicEvent(
      targetId,
      {
        eventDate: parsingResult.item.eventDate,
        eventTime: parsingResult.item.eventTime,
        deadline: parsingResult.item.deadline,
        status: parsingResult.item.status,
        submissionUrl: parsingResult.item.submissionUrl,
        subject: parsingResult.item.subject,
        resourceUrls: parsingResult.item.resourceUrls,
        attachmentNames: parsingResult.item.attachmentNames,
        originalMessages: parsingResult.item.originalMessages,
        needsConfirmation: parsingResult.item.needsConfirmation
      },
      latestChanges
    );

    // Record in raw_messages linked to event
    await recordRawMessage(rawMessage, {
      source,
      sourceGroup,
      sourceSender,
      messageTimestamp,
      sourceMessageId,
      processingStatus: "PROCESSED",
      linkedEventId: targetId
    });

    // Synchronize update to Notion
    const notionSync = updated
      ? await syncEventToNotion(updated, latestChanges)
      : { status: "SKIPPED" as const };

    return {
      action: "UPDATED",
      item: updated || undefined,
      changeSummary: parsingResult.changeSummary,
      beforeAfter: parsingResult.beforeAfter,
      notionSync,
      aiExtraction: parsingResult.aiExtraction,
      providerUsed: parsingResult.providerUsed
    };
  }

  // 8. Handle New Event Creation (Supabase Insert + Notion Page Creation)
  if (parsingResult.item) {
    // If subject was mapped from course code, apply it
    if (mappedSubject && parsingResult.item.subject === "NEEDS_CONFIRMATION") {
      parsingResult.item.subject = mappedSubject;
    }

    if (parsingResult.aiExtraction?.needsConfirmation || parsingResult.confidence === "NEEDS_CONFIRMATION") {
      parsingResult.item.needsConfirmation = true;
    }

    // Persist to Supabase
    const created = await createAcademicEvent(parsingResult.item);

    // Record in raw_messages linked to event
    await recordRawMessage(rawMessage, {
      source,
      sourceGroup,
      sourceSender,
      messageTimestamp,
      sourceMessageId,
      processingStatus: "PROCESSED",
      linkedEventId: created.id
    });

    // Synchronize creation to Notion
    const notionSync = await syncEventToNotion(created);

    return {
      action: "CREATED",
      item: created,
      notionSync,
      aiExtraction: parsingResult.aiExtraction,
      providerUsed: parsingResult.providerUsed,
      confidence: parsingResult.confidence,
      reason: parsingResult.reason
    };
  }

  return {
    action: "NON_ACADEMIC",
    reason: "No academic event could be generated from the message."
  };
}
