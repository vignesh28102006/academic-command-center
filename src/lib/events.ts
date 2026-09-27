import { AcademicItem, ChangeRecord, ParseResult } from "./types";
import { isNonAcademicMessage, parseAcademicMessage } from "./parser";
import { formatCalendarDate } from "./dateUtils";
import {
  AIExtractionOutput,
  AIParseContext,
  AIProvider,
  evaluateConfidence,
  parseAcademicMessageWithAI
} from "./ai";

/**
 * Match a message against existing items based on title tokens, snippet, and subject.
 */
function numbersDiffer(a: string, b: string): boolean {
  const numA = a.match(/\b\d+\b/g);
  const numB = b.match(/\b\d+\b/g);
  if (numA && numB) {
    return numA.join(",") !== numB.join(",");
  }
  return false;
}

export function findMatchingItem(
  title: string | null | undefined,
  targetSnippet: string | null | undefined,
  subject: string | null | undefined,
  existingItems: AcademicItem[],
  targetDate?: string | null | undefined
): AcademicItem | undefined {
  const normTitle = (title ?? "").toLowerCase().trim();
  const normSnippet = (targetSnippet ?? "").toLowerCase().trim();

  // 0. Match by target date if provided
  if (targetDate) {
    const dateMatch = existingItems.find(item => item.eventDate === targetDate);
    if (dateMatch) return dateMatch;
  }

  // 1. Direct match on snippet (e.g. "slip test 2", "lab 2", "assignment 1", "scheduled next Tuesday")
  if (normSnippet) {
    // If snippet mentions a day of the week, filter for items on that day
    const dayMatches = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
      .filter(d => normSnippet.includes(d));

    const matched = existingItems.find(item => {
      const itemTitle = item.title.toLowerCase();
      if (numbersDiffer(itemTitle, normSnippet)) return false;

      if (dayMatches.length > 0) {
        const itemDayMatches = dayMatches.some(d => {
          if (itemTitle.includes(d)) return true;
          if (item.eventDate) {
            const itemDow = new Date(item.eventDate).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
            return itemDow === d;
          }
          return false;
        });
        if (!itemDayMatches) return false;
      }
      return itemTitle === normSnippet ||
             itemTitle.includes(normSnippet) ||
             new RegExp(`\\b${normSnippet.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(itemTitle) ||
             new RegExp(`\\b${itemTitle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(normSnippet);
    });
    if (matched) return matched;
  }

  // 2. Exact or substring title match
  if (normTitle) {
    const directMatch = existingItems.find(item => {
      const itemTitle = item.title.toLowerCase();
      if (numbersDiffer(itemTitle, normTitle)) return false;
      return itemTitle === normTitle ||
             new RegExp(`\\b${normTitle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(itemTitle) ||
             new RegExp(`\\b${itemTitle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(normTitle);
    });
    if (directMatch) return directMatch;

    // 3. Significant token overlap (e.g. "slip test 2" vs "Slip Test 2")
    const tokens = normTitle.split(/\s+/).filter(w => w.length > 2);
    if (tokens.length >= 2) {
      const tokenMatch = existingItems.find(item => {
        const itemTitle = item.title.toLowerCase();
        if (numbersDiffer(itemTitle, normTitle)) return false;
        const itemTokens = itemTitle.split(/\s+/);
        const matches = tokens.filter(t => itemTokens.includes(t));
        return matches.length >= 2;
      });
      if (tokenMatch) return tokenMatch;
    }
  }

  return undefined;
}

export interface AIParsingResult extends ParseResult {
  aiExtraction?: AIExtractionOutput;
  aiExtractions?: AIExtractionOutput[];
  items?: AcademicItem[];
  results?: AIParsingResult[];
  providerUsed?: string;
  fallbackOccurred?: boolean;
  beforeAfter?: {
    before: Partial<AcademicItem>;
    after: Partial<AcademicItem>;
  };
}

/**
 * Process a single extraction candidate through the Event Intelligence Engine
 */
function processSingleExtraction(
  extraction: AIExtractionOutput,
  existingItems: AcademicItem[],
  trimmed: string,
  nowIso: string,
  options?: {
    sourceGroup?: string;
    sourceSender?: string;
    referenceDate?: Date;
    timezone?: string;
  },
  providerUsed?: string,
  fallbackOccurred?: boolean
): AIParsingResult {
  // 1. Handle NON_ACADEMIC
  if (extraction.action === "NON_ACADEMIC") {
    return {
      action: "NON_ACADEMIC",
      reason: "Message flagged as casual greeting or non-academic chatter.",
      aiExtraction: extraction,
      providerUsed,
      fallbackOccurred
    };
  }

  // 2. Handle IGNORED_DUPLICATE from AI
  if (extraction.action === "IGNORED_DUPLICATE") {
    return {
      action: "IGNORED_DUPLICATE",
      reason: "AI identified this message as a duplicate.",
      aiExtraction: extraction,
      providerUsed,
      fallbackOccurred
    };
  }

  // 3. Match against existing events
  const matchedItem = findMatchingItem(
    extraction.title,
    extraction.targetEventTitle,
    extraction.subject,
    existingItems,
    extraction.eventDate
  );

  // 4. If matched item exists and action indicates an update or modification:
  const isExplicitModification =
    extraction.action === "POSTPONED" ||
    extraction.action === "UPDATED" ||
    extraction.action === "CANCELLED" ||
    Boolean(extraction.targetEventTitle) ||
    Boolean(extraction.changeDescription);

  if (matchedItem && isExplicitModification) {
    const changes: ChangeRecord[] = [];
    const beforeState: Partial<AcademicItem> = {
      title: matchedItem.title,
      subject: matchedItem.subject,
      eventDate: matchedItem.eventDate,
      eventTime: matchedItem.eventTime,
      deadline: matchedItem.deadline,
      submissionUrl: matchedItem.submissionUrl,
      status: matchedItem.status
    };

    const updated: AcademicItem = {
      ...matchedItem,
      originalMessages: [
        ...(Array.isArray(matchedItem.originalMessages)
          ? matchedItem.originalMessages
          : matchedItem.originalMessages
            ? [matchedItem.originalMessages]
            : []),
        trimmed
      ],
      updatedAt: nowIso
    };

    // A. Postponement / Date change
    if (extraction.eventDate && extraction.eventDate !== matchedItem.eventDate) {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: nowIso,
        field: "eventDate",
        oldValue: matchedItem.eventDate,
        newValue: extraction.eventDate,
        summary: extraction.changeDescription || `Date changed from ${matchedItem.eventDate ? formatCalendarDate(matchedItem.eventDate) : "unspecified"} to ${formatCalendarDate(extraction.eventDate)} (Postponed)`,
        sourceMessage: trimmed
      });
      updated.eventDate = extraction.eventDate;
      updated.status = "POSTPONED";
    }

    if (extraction.eventTime && extraction.eventTime !== matchedItem.eventTime) {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: nowIso,
        field: "eventTime",
        oldValue: matchedItem.eventTime,
        newValue: extraction.eventTime,
        summary: `Time changed from ${matchedItem.eventTime ?? "unspecified"} to ${extraction.eventTime}`,
        sourceMessage: trimmed
      });
      updated.eventTime = extraction.eventTime;
    }

    // B. Cancellation
    if (extraction.action === "CANCELLED") {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: nowIso,
        field: "status",
        oldValue: matchedItem.status,
        newValue: "CANCELLED",
        summary: extraction.changeDescription || "Event was cancelled",
        sourceMessage: trimmed
      });
      updated.status = "CANCELLED";
    }

    // C. Deadline change / extension
    if (extraction.deadline && extraction.deadline !== matchedItem.deadline) {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: nowIso,
        field: "deadline",
        oldValue: matchedItem.deadline,
        newValue: extraction.deadline,
        summary: extraction.changeDescription || `Deadline changed to ${extraction.deadline}`,
        sourceMessage: trimmed
      });
      updated.deadline = extraction.deadline;
    }

    // D. Submission URL update
    if (extraction.submissionUrl && extraction.submissionUrl !== matchedItem.submissionUrl) {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: nowIso,
        field: "submissionUrl",
        oldValue: matchedItem.submissionUrl,
        newValue: extraction.submissionUrl,
        summary: `Submission link updated: ${extraction.submissionUrl}`,
        sourceMessage: trimmed
      });
      updated.submissionUrl = extraction.submissionUrl;
    }

    // E. Subject update if previously unknown
    if (updated.subject === "NEEDS_CONFIRMATION" && extraction.subject) {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: nowIso,
        field: "subject",
        oldValue: updated.subject,
        newValue: extraction.subject,
        summary: `Subject identified as ${extraction.subject}`,
        sourceMessage: trimmed
      });
      updated.subject = extraction.subject;
    }

    // F. Append resource URLs
    for (const resUrl of extraction.resourceUrls) {
      if (!updated.resourceUrls.includes(resUrl)) {
        updated.resourceUrls.push(resUrl);
        changes.push({
          id: crypto.randomUUID(),
          timestamp: nowIso,
          field: "resourceUrls",
          newValue: resUrl,
          summary: `Resource link added: ${resUrl}`,
          sourceMessage: trimmed
        });
      }
    }

    // Append to change history
    updated.changeHistory = [...(matchedItem.changeHistory ?? []), ...changes];

    const changeSummary = changes.length > 0
      ? changes.map(c => c.summary).join("; ")
      : extraction.changeDescription || "Event updated with new message.";

    const afterState: Partial<AcademicItem> = {
      title: updated.title,
      subject: updated.subject,
      eventDate: updated.eventDate,
      eventTime: updated.eventTime,
      deadline: updated.deadline,
      submissionUrl: updated.submissionUrl,
      status: updated.status
    };

    return {
      action: "UPDATED",
      item: updated,
      updatedItemId: updated.id,
      changeSummary,
      aiExtraction: extraction,
      providerUsed,
      fallbackOccurred,
      beforeAfter: {
        before: beforeState,
        after: afterState
      }
    };
  }

  // 5. Otherwise: Create a brand new item
  const confidenceLevel = evaluateConfidence(
    extraction.confidence,
    extraction.needsConfirmation
  );

  const subject = extraction.subject ?? (options?.sourceGroup ? options.sourceGroup : "NEEDS_CONFIRMATION");
  const title = extraction.title ?? "New Academic Event";

  const newItem: AcademicItem = {
    id: crypto.randomUUID(),
    title,
    subject,
    type: extraction.type,
    status: extraction.needsConfirmation ? "INBOX" : "INBOX",
    deadline: extraction.deadline ?? (extraction.deadlineTime && extraction.eventDate ? `${extraction.eventDate}T${extraction.deadlineTime}` : undefined),
    eventDate: extraction.eventDate ?? (extraction.deadline && /^\d{4}-\d{2}-\d{2}/.test(extraction.deadline) ? extraction.deadline.slice(0, 10) : undefined),
    eventTime: extraction.eventTime ?? extraction.deadlineTime ?? undefined,
    submissionUrl: extraction.submissionUrl ?? undefined,
    resourceUrls: extraction.resourceUrls,
    attachmentNames: extraction.attachmentNames,
    description: extraction.description ?? trimmed,
    sourceGroup: options?.sourceGroup,
    sourceSender: options?.sourceSender,
    originalMessages: [trimmed],
    createdAt: nowIso,
    updatedAt: nowIso,
    changeHistory: [],
    confidence: confidenceLevel,
    needsConfirmation: Boolean(extraction.needsConfirmation || confidenceLevel === "NEEDS_CONFIRMATION")
  };

  return {
    action: extraction.needsConfirmation ? "CREATED" : "CREATED",
    item: newItem,
    aiExtraction: extraction,
    providerUsed,
    fallbackOccurred,
    confidence: confidenceLevel,
    reason: extraction.confirmationReason ?? undefined
  };
}

/**
 * Phase 2 & 4B AI-Powered Academic Event Processor.
 * Combines AI structured extraction with the Event Intelligence Engine.
 * Supports messages containing single or multiple academic events / multiple dates.
 */
export async function processAcademicMessageWithAI(
  text: string,
  existingItems: AcademicItem[],
  options?: {
    sourceGroup?: string;
    sourceSender?: string;
    referenceDate?: Date;
    timezone?: string;
  },
  customAIProvider?: AIProvider
): Promise<AIParsingResult> {
  const refDate = options?.referenceDate ?? new Date();
  const timezone = options?.timezone ?? "Asia/Kolkata";
  const nowIso = refDate.toISOString();
  const currentDate = refDate.toISOString().slice(0, 10);
  const trimmed = text.trim();

  // 1. Check for duplicate raw message before calling AI
  const duplicateItem = existingItems.find(item =>
    item && Array.isArray(item.originalMessages) &&
    item.originalMessages.some(m => typeof m === "string" && m.trim().toLowerCase() === trimmed.toLowerCase())
  );
  if (duplicateItem) {
    return {
      action: "IGNORED_DUPLICATE",
      item: duplicateItem,
      items: [duplicateItem],
      updatedItemId: duplicateItem.id,
      reason: `Duplicate message already recorded for "${duplicateItem.title}".`,
      confidence: "HIGH"
    };
  }

  // 2. Build Context for AI model
  const context: AIParseContext = {
    currentDate,
    currentDateTime: nowIso,
    timezone,
    sourceGroup: options?.sourceGroup,
    sourceSender: options?.sourceSender,
    existingEvents: existingItems.map(item => ({
      id: item.id,
      title: item.title,
      subject: item.subject,
      type: item.type,
      eventDate: item.eventDate,
      eventTime: item.eventTime,
      deadline: item.deadline,
      submissionUrl: item.submissionUrl,
      status: item.status
    }))
  };

  // 3. Extract with AI Provider (or fallback)
  const { extraction, extractions, providerUsed, fallbackOccurred } =
    await parseAcademicMessageWithAI(trimmed, context, customAIProvider);

  const eventList = (extractions && extractions.length > 0) ? extractions : [extraction];

  // 4. Process each extracted candidate independently through Event Intelligence Engine
  const results: AIParsingResult[] = [];
  const currentItems = [...existingItems];

  for (const ext of eventList) {
    const subResult = processSingleExtraction(
      ext,
      currentItems,
      trimmed,
      nowIso,
      options,
      providerUsed,
      fallbackOccurred
    );
    results.push(subResult);

    // Keep tracking in current batch to maintain consistency
    if (subResult.item) {
      currentItems.push(subResult.item);
    }
  }

  // Filter items
  const items = results.map(r => r.item).filter((item): item is AcademicItem => Boolean(item));

  // Determine overall action
  const primaryAction = results.every(r => r.action === "IGNORED_DUPLICATE")
    ? "IGNORED_DUPLICATE"
    : results.every(r => r.action === "NON_ACADEMIC")
      ? "NON_ACADEMIC"
      : results.every(r => r.action === "UPDATED")
        ? "UPDATED"
        : "CREATED";

  const firstResult = results[0] || {
    action: "NON_ACADEMIC",
    reason: "No events extracted."
  };

  return {
    action: primaryAction,
    item: items[0],
    items,
    results,
    updatedItemId: firstResult.updatedItemId,
    changeSummary: results.map(r => r.changeSummary).filter(Boolean).join("; ") || undefined,
    aiExtraction: eventList[0],
    aiExtractions: eventList,
    providerUsed,
    fallbackOccurred,
    confidence: firstResult.confidence,
    reason: firstResult.reason,
    beforeAfter: firstResult.beforeAfter
  };
}

/**
 * Convenience helper explicitly returning an array of items for multiple academic events
 */
export async function processMultipleAcademicEventsWithAI(
  text: string,
  existingItems: AcademicItem[],
  options?: {
    sourceGroup?: string;
    sourceSender?: string;
    referenceDate?: Date;
    timezone?: string;
  },
  customAIProvider?: AIProvider
): Promise<{
  action: "CREATED" | "UPDATED" | "IGNORED_DUPLICATE" | "NON_ACADEMIC";
  items: AcademicItem[];
  results: AIParsingResult[];
  rawResult: AIParsingResult;
}> {
  const rawResult = await processAcademicMessageWithAI(text, existingItems, options, customAIProvider);
  return {
    action: rawResult.action as any,
    items: rawResult.items ?? (rawResult.item ? [rawResult.item] : []),
    results: rawResult.results ?? [rawResult],
    rawResult
  };
}

/**
 * Phase 1 deterministic processor preserved for backward compatibility and fast local testing
 */
export function processAcademicMessage(
  text: string,
  existingItems: AcademicItem[],
  options?: {
    sourceGroup?: string;
    sourceSender?: string;
    referenceDate?: Date;
  }
): ParseResult {
  const now = new Date().toISOString();
  const trimmed = text.trim();

  // 1. Check for non-academic chatter
  if (isNonAcademicMessage(trimmed)) {
    return {
      action: "NON_ACADEMIC",
      reason: "Message flagged as casual greeting or non-academic chatter."
    };
  }

  // 2. Parse structured fields
  const parsed = parseAcademicMessage(trimmed, options);

  // 3. Check for exact duplicate message
  const duplicateItem = existingItems.find(item =>
    item && Array.isArray(item.originalMessages) &&
    item.originalMessages.some(m => typeof m === "string" && m.trim().toLowerCase() === trimmed.toLowerCase())
  );
  if (duplicateItem) {
    return {
      action: "IGNORED_DUPLICATE",
      item: duplicateItem,
      updatedItemId: duplicateItem.id,
      reason: `Duplicate message already recorded for "${duplicateItem.title}".`
    };
  }

  // 4. Check if message targets an existing event
  const targetSnippet = parsed.modificationIntent.targetTitleSnippet;
  const matchedItem = findMatchingItem(
    parsed.title,
    targetSnippet,
    parsed.subject,
    existingItems
  );

  // 5. If matched item exists and this is a modification or contains new information:
  if (matchedItem) {
    const changes: ChangeRecord[] = [];
    const updated: AcademicItem = {
      ...matchedItem,
      originalMessages: [...matchedItem.originalMessages, trimmed],
      updatedAt: now
    };

    // If source group provides subject and existing item needs confirmation:
    if (updated.subject === "NEEDS_CONFIRMATION" && parsed.subject !== "NEEDS_CONFIRMATION") {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: now,
        field: "subject",
        oldValue: updated.subject,
        newValue: parsed.subject,
        summary: `Subject identified as ${parsed.subject}`,
        sourceMessage: trimmed
      });
      updated.subject = parsed.subject;
    }

    // A. Postponement / Date change
    if (parsed.modificationIntent.type === "POSTPONEMENT" || (parsed.eventDate && parsed.eventDate !== matchedItem.eventDate)) {
      const newDate = parsed.modificationIntent.newDate ?? parsed.eventDate;
      const newTime = parsed.modificationIntent.newTime ?? parsed.eventTime;

      if (newDate && newDate !== matchedItem.eventDate) {
        changes.push({
          id: crypto.randomUUID(),
          timestamp: now,
          field: "eventDate",
          oldValue: matchedItem.eventDate,
          newValue: newDate,
          summary: `Date changed from ${matchedItem.eventDate ? formatCalendarDate(matchedItem.eventDate) : "unspecified"} to ${formatCalendarDate(newDate)} (Postponed)`,
          sourceMessage: trimmed
        });
        updated.eventDate = newDate;
        updated.status = "POSTPONED";
      }

      if (newTime && newTime !== matchedItem.eventTime) {
        changes.push({
          id: crypto.randomUUID(),
          timestamp: now,
          field: "eventTime",
          oldValue: matchedItem.eventTime,
          newValue: newTime,
          summary: `Time changed from ${matchedItem.eventTime ?? "unspecified"} to ${newTime}`,
          sourceMessage: trimmed
        });
        updated.eventTime = newTime;
      }
    }

    // B. Cancellation
    if (parsed.modificationIntent.type === "CANCELLATION") {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: now,
        field: "status",
        oldValue: matchedItem.status,
        newValue: "CANCELLED",
        summary: "Event was cancelled",
        sourceMessage: trimmed
      });
      updated.status = "CANCELLED";
    }

    // C. Deadline Extension
    if (parsed.modificationIntent.type === "DEADLINE_EXTENSION" || (parsed.deadline && parsed.deadline !== matchedItem.deadline)) {
      const newDeadline = parsed.deadline;
      if (newDeadline && newDeadline !== matchedItem.deadline) {
        changes.push({
          id: crypto.randomUUID(),
          timestamp: now,
          field: "deadline",
          oldValue: matchedItem.deadline,
          newValue: newDeadline,
          summary: `Deadline extended to ${newDeadline}`,
          sourceMessage: trimmed
        });
        updated.deadline = newDeadline;
      }
    }

    // D. Submission Link Changed / Added
    if (parsed.submissionUrl && parsed.submissionUrl !== matchedItem.submissionUrl) {
      changes.push({
        id: crypto.randomUUID(),
        timestamp: now,
        field: "submissionUrl",
        oldValue: matchedItem.submissionUrl,
        newValue: parsed.submissionUrl,
        summary: `Submission link updated: ${parsed.submissionUrl}`,
        sourceMessage: trimmed
      });
      updated.submissionUrl = parsed.submissionUrl;
    }

    // E. New resource URLs or attachments
    for (const resUrl of parsed.resourceUrls) {
      if (!updated.resourceUrls.includes(resUrl)) {
        updated.resourceUrls.push(resUrl);
        changes.push({
          id: crypto.randomUUID(),
          timestamp: now,
          field: "resourceUrls",
          newValue: resUrl,
          summary: `Resource link added: ${resUrl}`,
          sourceMessage: trimmed
        });
      }
    }

    for (const att of parsed.attachmentNames) {
      if (!updated.attachmentNames.includes(att)) {
        updated.attachmentNames.push(att);
        changes.push({
          id: crypto.randomUUID(),
          timestamp: now,
          field: "attachmentNames",
          newValue: att,
          summary: `Attachment added: ${att}`,
          sourceMessage: trimmed
        });
      }
    }

    // Append to change history
    updated.changeHistory = [...(matchedItem.changeHistory ?? []), ...changes];

    const changeSummary = changes.length > 0
      ? changes.map(c => c.summary).join("; ")
      : "Additional message recorded.";

    return {
      action: "UPDATED",
      item: updated,
      updatedItemId: updated.id,
      changeSummary
    };
  }

  // 6. Otherwise: Create a brand new item
  const newItem: AcademicItem = {
    id: crypto.randomUUID(),
    title: parsed.title,
    subject: parsed.subject,
    type: parsed.type,
    status: parsed.status,
    deadline: parsed.deadline,
    eventDate: parsed.eventDate,
    eventTime: parsed.eventTime,
    submissionUrl: parsed.submissionUrl,
    resourceUrls: parsed.resourceUrls,
    attachmentNames: parsed.attachmentNames,
    description: parsed.description,
    sourceGroup: parsed.sourceGroup,
    sourceSender: parsed.sourceSender,
    originalMessages: parsed.originalMessages,
    createdAt: now,
    updatedAt: now,
    changeHistory: [],
    confidence: parsed.confidence
  };

  return {
    action: "CREATED",
    item: newItem,
    confidence: parsed.confidence
  };
}
