import { NextResponse } from "next/server";
import { getAcademicEventById, updateAcademicEvent, deleteAcademicEvent } from "@/lib/db/academicEvents";
import { syncEventToNotion } from "@/lib/notion/sync";
import { ChangeRecord } from "@/lib/types";

interface Params {
  params: {
    id: string;
  };
}

export async function GET(request: Request, { params }: Params) {
  try {
    const event = await getAcademicEventById(params.id);
    if (!event) {
      return NextResponse.json({ error: "Academic event not found" }, { status: 404 });
    }
    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch event" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const id = params.id;
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Update payload required" }, { status: 400 });
    }

    const existing = await getAcademicEventById(id);
    if (!existing) {
      return NextResponse.json({ error: "Academic event not found" }, { status: 404 });
    }

    const updates = body.updates || body;
    const newChanges: ChangeRecord[] = Array.isArray(body.changes) ? body.changes : [];

    // If status changed and no explicit change record passed, generate one
    if (updates.status && updates.status !== existing.status && newChanges.length === 0) {
      newChanges.push({
        id: crypto.randomUUID(),
        eventId: id,
        timestamp: new Date().toISOString(),
        field: "status",
        oldValue: existing.status,
        newValue: updates.status,
        summary: `Status changed from ${existing.status} to ${updates.status}`
      });
    }

    // 1. Update in Supabase (Source of truth)
    const updated = await updateAcademicEvent(id, updates, newChanges);
    if (!updated) {
      return NextResponse.json({ error: "Failed to update academic event" }, { status: 500 });
    }

    // 2. Synchronize update to Notion
    const notionSync = await syncEventToNotion(updated, newChanges);

    return NextResponse.json({
      event: updated,
      notionSync
    });
  } catch (err) {
    console.error("PATCH /api/events/:id error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update academic event" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const id = params.id;
    const success = await deleteAcademicEvent(id);
    return NextResponse.json({ success });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete academic event" },
      { status: 500 }
    );
  }
}
