import { NextResponse } from "next/server";
import { processAcademicMessageWithAI } from "@/lib/events";
import {
  getAllAcademicEvents,
  createAcademicEvent,
  updateAcademicEvent
} from "@/lib/db/academicEvents";
import { resolveSubjectCode } from "@/lib/db/subjectMappings";
import { recordRawMessage } from "@/lib/db/rawMessages";
import { syncEventToNotion } from "@/lib/notion/sync";
import { AcademicItem } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const rawMessage = typeof body?.message === "string"
    ? body.message.trim()
    : typeof body?.text === "string"
      ? body.text.trim()
      : "";

  let existingItems: AcademicItem[] = Array.isArray(body?.existingItems) ? body.existingItems : [];
  const sourceGroup = typeof body?.sourceGroup === "string" ? body.sourceGroup.trim() : undefined;
  const sourceSender = typeof body?.sourceSender === "string" ? body.sourceSender.trim() : undefined;

  if (!rawMessage) {
    return NextResponse.json({ error: "Message text is required." }, { status: 400 });
  }

  // If client did not pass existingItems, query from Supabase
  if (existingItems.length === 0) {
    existingItems = await getAllAcademicEvents();
  }

  // Check subject mapping
  const mappedSubject = await resolveSubjectCode(rawMessage) ||
    (sourceGroup ? await resolveSubjectCode(sourceGroup) : null);

  try {
    const result = await processAcademicMessageWithAI(
      rawMessage,
      existingItems,
      {
        sourceGroup: mappedSubject || sourceGroup,
        sourceSender,
        timezone: "Asia/Kolkata"
      }
    );

    let persistedItem = result.item;
    let notionSync: any = { status: "SKIPPED" };

    if (result.action === "UPDATED" && result.item) {
      const targetId = result.updatedItemId || result.item.id;
      const latestChanges = result.item.changeHistory.slice(-3);
      persistedItem = await updateAcademicEvent(
        targetId,
        {
          eventDate: result.item.eventDate,
          eventTime: result.item.eventTime,
          deadline: result.item.deadline,
          status: result.item.status,
          submissionUrl: result.item.submissionUrl,
          subject: result.item.subject,
          resourceUrls: result.item.resourceUrls,
          attachmentNames: result.item.attachmentNames,
          originalMessages: result.item.originalMessages,
          needsConfirmation: result.item.needsConfirmation
        },
        latestChanges
      ) || result.item;

      notionSync = await syncEventToNotion(persistedItem, latestChanges);

      await recordRawMessage(rawMessage, {
        sourceGroup,
        sourceSender,
        processingStatus: "PROCESSED",
        linkedEventId: targetId
      });
    } else if (result.action === "CREATED" && result.item) {
      if (mappedSubject && result.item.subject === "NEEDS_CONFIRMATION") {
        result.item.subject = mappedSubject;
      }
      if (result.aiExtraction?.needsConfirmation || result.confidence === "NEEDS_CONFIRMATION") {
        result.item.needsConfirmation = true;
      }
      persistedItem = await createAcademicEvent(result.item);
      notionSync = await syncEventToNotion(persistedItem);

      await recordRawMessage(rawMessage, {
        sourceGroup,
        sourceSender,
        processingStatus: "PROCESSED",
        linkedEventId: persistedItem.id
      });
    } else if (result.action === "NON_ACADEMIC") {
      await recordRawMessage(rawMessage, {
        sourceGroup,
        sourceSender,
        processingStatus: "NON_ACADEMIC"
      });
    }

    return NextResponse.json({
      result: {
        action: result.action,
        item: persistedItem,
        updatedItemId: result.updatedItemId,
        changeSummary: result.changeSummary,
        reason: result.reason,
        confidence: result.confidence
      },
      notionSync,
      aiExtraction: result.aiExtraction ?? null,
      validation: {
        valid: true,
        confidenceScore: result.aiExtraction?.confidence ?? null,
        confidenceLevel: result.confidence ?? "MEDIUM",
        needsConfirmation: result.aiExtraction?.needsConfirmation ?? false,
        confirmationReason: result.aiExtraction?.confirmationReason ?? null
      },
      providerUsed: result.providerUsed ?? "deterministic-fallback",
      fallbackOccurred: result.fallbackOccurred ?? false,
      beforeAfter: result.beforeAfter ?? null
    });
  } catch (err) {
    console.error("Parse route error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to process academic message."
      },
      { status: 500 }
    );
  }
}