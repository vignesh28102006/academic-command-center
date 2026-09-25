import { AcademicItem, ChangeRecord, ParseResult } from "./types";
import { isNonAcademicMessage, parseAcademicMessage } from "./parser";
import { formatCalendarDate } from "./dateUtils";

/**
 * Match a message against existing items based on title tokens and subject.
 */
function findMatchingItem(
  title: string,
  targetSnippet: string | undefined,
  subject: string,
  existingItems: AcademicItem[]
): AcademicItem | undefined {
  const normTitle = title.toLowerCase().trim();
  const normSnippet = targetSnippet?.toLowerCase().trim();

  // 1. Direct match on snippet (e.g. "slip test 2", "lab 2", "assignment 1")
  if (normSnippet) {
    const matched = existingItems.find(item => {
      const itemTitle = item.title.toLowerCase();
      return itemTitle.includes(normSnippet) || normSnippet.includes(itemTitle);
    });
    if (matched) return matched;
  }

  // 2. Exact or substring title match
  const directMatch = existingItems.find(item => {
    const itemTitle = item.title.toLowerCase();
    return itemTitle === normTitle ||
           itemTitle.includes(normTitle) ||
           normTitle.includes(itemTitle);
  });
  if (directMatch) return directMatch;

  // 3. Significant token overlap (e.g. "slip test 2" vs "Slip Test 2")
  const tokens = normTitle.split(/\s+/).filter(w => w.length > 2);
  if (tokens.length >= 2) {
    const tokenMatch = existingItems.find(item => {
      const itemTokens = item.title.toLowerCase().split(/\s+/);
      const matches = tokens.filter(t => itemTokens.includes(t));
      return matches.length >= 2;
    });
    if (tokenMatch) return tokenMatch;
  }

  return undefined;
}

/**
 * Core event processor that handles new academic messages, duplicate detection,
 * and updates existing items with full change history when modifications occur.
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
    item.originalMessages.some(m => m.trim().toLowerCase() === trimmed.toLowerCase())
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
