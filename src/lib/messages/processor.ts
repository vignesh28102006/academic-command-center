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
import { isGroupAllowed } from "../collector/allowedGroups";
import { classifyAcademicMessage } from "../collector/relevanceFilter";

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
  items?: AcademicItem[];
  results?: ProcessMessageResult[];
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

  // 1a. Strict Group Allowlist Gate (Disallowed groups must NEVER reach Gemini, Supabase, or Notion)
  if (sourceGroup && !isGroupAllowed(sourceGroup)) {
    return {
      action: "NON_ACADEMIC",
      reason: `Group '${sourceGroup}' is not in the allowed academic groups list.`
    };
  }

  // 1b. Strict Academic Relevance Gate (Drop advertisements, attendance-only, chatter before AI)
  const relevance = classifyAcademicMessage(rawMessage);
  if (!relevance.shouldProcess) {
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
      reason: relevance.reason
    };
  }

  // 1c. Message Hash Deduplication Check
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
      sourceMessageTimestamp: messageTimestamp,
      sourceMessageDate: messageTimestamp ? messageTimestamp.slice(0, 10) : undefined,
      referenceDate: messageTimestamp ? new Date(messageTimestamp) : undefined,
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
      item: parsingResult.item,
      items: parsingResult.items
    };
  }

  // 7. Multi-event handling: If message contains multiple distinct academic events / dates
  if (parsingResult.results && parsingResult.results.length > 1) {
    const persistedItems: AcademicItem[] = [];
    const subResults: ProcessMessageResult[] = [];

    for (const sub of parsingResult.results) {
      if (sub.action === "UPDATED" && sub.item) {
        const targetId = sub.updatedItemId || sub.item.id;
        const latestChanges = sub.item.changeHistory.slice(-3);
        const updated = await updateAcademicEvent(
          targetId,
          {
            eventDate: sub.item.eventDate,
            eventTime: sub.item.eventTime,
            deadline: sub.item.deadline,
            status: sub.item.status,
            submissionUrl: sub.item.submissionUrl,
            subject: sub.item.subject,
            resourceUrls: sub.item.resourceUrls,
            attachmentNames: sub.item.attachmentNames,
            originalMessages: sub.item.originalMessages,
            needsConfirmation: sub.item.needsConfirmation
          },
          latestChanges
        );
        const notionSync = updated ? await syncEventToNotion(updated, latestChanges) : { status: "SKIPPED" as const };
        if (updated) persistedItems.push(updated);
        subResults.push({
          action: "UPDATED",
          item: updated || undefined,
          changeSummary: sub.changeSummary,
          notionSync,
          aiExtraction: sub.aiExtraction
        });
      } else if (sub.item) {
        if (mappedSubject && sub.item.subject === "NEEDS_CONFIRMATION") {
          sub.item.subject = mappedSubject;
        }
        if (sub.aiExtraction?.needsConfirmation || sub.confidence === "NEEDS_CONFIRMATION") {
          sub.item.needsConfirmation = true;
        }
        if (!sub.item.sourceMessageTimestamp && messageTimestamp) {
          sub.item.sourceMessageTimestamp = messageTimestamp;
          sub.item.sourceMessageDate = messageTimestamp.slice(0, 10);
        }
        const created = await createAcademicEvent(sub.item);
        const notionSync = await syncEventToNotion(created);
        persistedItems.push(created);
        subResults.push({
          action: "CREATED",
          item: created,
          notionSync,
          aiExtraction: sub.aiExtraction,
          confidence: sub.confidence
        });
      }
    }

    await recordRawMessage(rawMessage, {
      source,
      sourceGroup,
      sourceSender,
      messageTimestamp,
      sourceMessageId,
      processingStatus: "PROCESSED",
      linkedEventId: persistedItems[0]?.id
    });

    return {
      action: parsingResult.action,
      item: persistedItems[0],
      items: persistedItems,
      results: subResults,
      changeSummary: parsingResult.changeSummary,
      providerUsed: parsingResult.providerUsed,
      confidence: parsingResult.confidence,
      reason: parsingResult.reason
    };
  }

  // 8. Handle Single Modification to Existing Event (Supabase Update + Notion Sync)
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
      items: updated ? [updated] : [],
      changeSummary: parsingResult.changeSummary,
      beforeAfter: parsingResult.beforeAfter,
      notionSync,
      aiExtraction: parsingResult.aiExtraction,
      providerUsed: parsingResult.providerUsed
    };
  }

  // 9. Handle Single New Event Creation (Supabase Insert + Notion Page Creation)
  if (parsingResult.item) {
    // If subject was mapped from course code, apply it
    if (mappedSubject && parsingResult.item.subject === "NEEDS_CONFIRMATION") {
      parsingResult.item.subject = mappedSubject;
    }

    if (parsingResult.aiExtraction?.needsConfirmation || parsingResult.confidence === "NEEDS_CONFIRMATION") {
      parsingResult.item.needsConfirmation = true;
    }

    if (!parsingResult.item.sourceMessageTimestamp && messageTimestamp) {
      parsingResult.item.sourceMessageTimestamp = messageTimestamp;
      parsingResult.item.sourceMessageDate = messageTimestamp.slice(0, 10);
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
      items: [created],
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
