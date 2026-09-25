import { NextResponse } from "next/server";
import { processAcademicMessageWithAI } from "@/lib/events";
import {
  getAllAcademicEvents,
  createAcademicEvent,
  updateAcademicEvent
} from "@/lib/db/academicEvents";
import { hashMessage, isMessageProcessed, recordRawMessage } from "@/lib/db/rawMessages";
import { resolveSubjectCode } from "@/lib/db/subjectMappings";
import { syncEventToNotion } from "@/lib/notion/sync";
import { AcademicItem } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const rawMessage = typeof body?.message === "string"
      ? body.message.trim()
      : typeof body?.text === "string"
        ? body.text.trim()
        : "";

    const sourceGroup = typeof body?.sourceGroup === "string" ? body.sourceGroup.trim() : undefined;
    const sourceSender = typeof body?.sourceSender === "string" ? body.sourceSender.trim() : undefined;

    if (!rawMessage) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }

    // 1. Message Hash Deduplication Check
    const messageHash = hashMessage(rawMessage);
    const alreadyProcessed = await isMessageProcessed(messageHash);
    if (alreadyProcessed) {
      return NextResponse.json({
        action: "IGNORED_DUPLICATE",
        reason: "Exact message already processed and recorded in message store."
      });
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
        sourceGroup: mappedSubject || sourceGroup,
        sourceSender,
        timezone: "Asia/Kolkata"
      }
    );

    // 5. Handle Non-Academic Chatter
    if (parsingResult.action === "NON_ACADEMIC") {
      await recordRawMessage(rawMessage, {
        sourceGroup,
        sourceSender,
        processingStatus: "NON_ACADEMIC"
      });

      return NextResponse.json({
        action: "NON_ACADEMIC",
        reason: parsingResult.reason || "Filtered as non-academic chatter.",
        aiExtraction: parsingResult.aiExtraction,
        providerUsed: parsingResult.providerUsed
      });
    }

    // 6. Handle Duplicate Detection from Event Engine
    if (parsingResult.action === "IGNORED_DUPLICATE") {
      await recordRawMessage(rawMessage, {
        sourceGroup,
        sourceSender,
        processingStatus: "IGNORED_DUPLICATE",
        linkedEventId: parsingResult.updatedItemId
      });

      return NextResponse.json({
        action: "IGNORED_DUPLICATE",
        reason: parsingResult.reason || "Duplicate message detected.",
        item: parsingResult.item
      });
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
        sourceGroup,
        sourceSender,
        processingStatus: "PROCESSED",
        linkedEventId: targetId
      });

      // Synchronize update to Notion
      const notionSync = updated
        ? await syncEventToNotion(updated, latestChanges)
        : { status: "SKIPPED" };

      return NextResponse.json({
        action: "UPDATED",
        item: updated,
        changeSummary: parsingResult.changeSummary,
        beforeAfter: parsingResult.beforeAfter,
        notionSync,
        aiExtraction: parsingResult.aiExtraction,
        providerUsed: parsingResult.providerUsed
      });
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
        sourceGroup,
        sourceSender,
        processingStatus: "PROCESSED",
        linkedEventId: created.id
      });

      // Synchronize creation to Notion
      const notionSync = await syncEventToNotion(created);

      return NextResponse.json({
        action: "CREATED",
        item: created,
        notionSync,
        aiExtraction: parsingResult.aiExtraction,
        providerUsed: parsingResult.providerUsed,
        confidence: parsingResult.confidence,
        reason: parsingResult.reason
      }, { status: 201 });
    }

    return NextResponse.json({
      error: "No academic event could be generated from the message."
    }, { status: 422 });
  } catch (err) {
    console.error("POST /api/messages/process error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process message." },
      { status: 500 }
    );
  }
}
