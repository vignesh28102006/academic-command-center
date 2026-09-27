import { NextResponse } from "next/server";
import { getAllAcademicEvents, createAcademicEvent } from "@/lib/db/academicEvents";
import { syncEventToNotion } from "@/lib/notion/sync";
import { AcademicItem } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const type = searchParams.get("type") || undefined;
    const subject = searchParams.get("subject") || undefined;
    const search = searchParams.get("search") || undefined;

    const events = await getAllAcademicEvents({
      status,
      type,
      subject,
      search
    });

    return NextResponse.json({ events });
  } catch (err) {
    console.error("GET /api/events error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch academic events" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.title) {
      return NextResponse.json({ error: "Title is required for an academic event." }, { status: 400 });
    }

    const itemToCreate: AcademicItem = {
      id: body.id || crypto.randomUUID(),
      title: body.title,
      subject: body.subject || "NEEDS_CONFIRMATION",
      type: body.type || "OTHER",
      status: body.status || "INBOX",
      eventDate: body.eventDate || undefined,
      eventTime: body.eventTime || undefined,
      deadline: body.deadline || undefined,
      deadlineTime: body.deadlineTime || undefined,
      submissionUrl: body.submissionUrl || undefined,
      resourceUrls: Array.isArray(body.resourceUrls) ? body.resourceUrls : [],
      attachmentNames: Array.isArray(body.attachmentNames) ? body.attachmentNames : [],
      description: body.description || "",
      requirements: Array.isArray(body.requirements) ? body.requirements : [],
      sourceGroup: body.sourceGroup || undefined,
      sourceSender: body.sourceSender || undefined,
      originalMessages: Array.isArray(body.originalMessages) ? body.originalMessages : [],
      needsConfirmation: Boolean(body.needsConfirmation),
      confidence: body.confidence || "MEDIUM",
      confidenceScore: body.confidenceScore || 0.8,
      createdAt: body.createdAt || new Date().toISOString(),
      updatedAt: body.updatedAt || new Date().toISOString(),
      changeHistory: []
    };

    // 1. Create in Supabase (Source of Truth)
    const created = await createAcademicEvent(itemToCreate);

    // 2. Sync to Notion (One-way Sync)
    const notionSync = await syncEventToNotion(created);

    return NextResponse.json({
      event: created,
      notionSync
    }, { status: 201 });
  } catch (err) {
    console.error("POST /api/events error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create academic event" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const singleId = searchParams.get("id");
    const body = await request.json().catch(() => null);
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : (singleId ? [singleId] : []);

    if (ids.length === 0) {
      return NextResponse.json({ error: "No event IDs provided for deletion" }, { status: 400 });
    }

    const { deleteAcademicEvent } = await import("@/lib/db/academicEvents");
    let deletedCount = 0;
    for (const eventId of ids) {
      const ok = await deleteAcademicEvent(eventId);
      if (ok) deletedCount++;
    }

    return NextResponse.json({ status: "ok", deletedCount, deletedIds: ids });
  } catch (err) {
    console.error("DELETE /api/events error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete academic events" },
      { status: 500 }
    );
  }
}

