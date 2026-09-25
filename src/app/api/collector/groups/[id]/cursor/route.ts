import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getCollectorGroupByRef,
  updateCollectorGroupCursor,
  getOrCreateCollectorGroup
} from "@/lib/db/collectorState";
import { verifyCollectorAuth } from "@/lib/collector/auth";

export const dynamic = "force-dynamic";

const cursorUpdateSchema = z.object({
  groupName: z.string().optional(),
  lastProcessedMessageTimestamp: z.string().optional().nullable(),
  lastProcessedMessageId: z.string().optional().nullable(),
  backfillComplete: z.boolean().optional(),
  status: z.enum([
    "IDLE",
    "DISCOVERING_GROUPS",
    "BACKFILLING",
    "MONITORING",
    "SCANNING",
    "PAUSED",
    "ERROR",
    "WHATSAPP_UNAVAILABLE"
  ]).optional(),
  messagesScannedIncrement: z.number().int().optional(),
  messagesProcessedIncrement: z.number().int().optional(),
  messagesIgnoredIncrement: z.number().int().optional(),
  lastError: z.string().optional().nullable()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = verifyCollectorAuth(request);
  if (!auth.authorized) {
    return auth.response!;
  }

  const { id } = await Promise.resolve(params);
  const body = await request.json().catch(() => null);
  const parsed = cursorUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Malformed cursor update payload.",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)
      },
      { status: 400 }
    );
  }

  const existing = await getCollectorGroupByRef(id) ||
    await getOrCreateCollectorGroup(parsed.data.groupName || id, id);

  const updates: any = {};
  if (parsed.data.groupName) updates.groupName = parsed.data.groupName;
  if (parsed.data.lastProcessedMessageTimestamp !== undefined) {
    updates.lastProcessedMessageTimestamp = parsed.data.lastProcessedMessageTimestamp;
  }
  if (parsed.data.lastProcessedMessageId !== undefined) {
    updates.lastProcessedMessageId = parsed.data.lastProcessedMessageId;
  }
  if (parsed.data.backfillComplete !== undefined) {
    updates.backfillComplete = parsed.data.backfillComplete;
  }
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
  }
  if (parsed.data.lastError !== undefined) {
    updates.lastError = parsed.data.lastError;
  }

  // Increments
  if (parsed.data.messagesScannedIncrement) {
    updates.messagesScanned = (existing.messagesScanned || 0) + parsed.data.messagesScannedIncrement;
  }
  if (parsed.data.messagesProcessedIncrement) {
    updates.messagesProcessed = (existing.messagesProcessed || 0) + parsed.data.messagesProcessedIncrement;
  }
  if (parsed.data.messagesIgnoredIncrement) {
    updates.messagesIgnored = (existing.messagesIgnored || 0) + parsed.data.messagesIgnoredIncrement;
  }

  const updated = await updateCollectorGroupCursor(existing.groupIdentifier, updates);

  return NextResponse.json({
    status: "ok",
    group: updated
  });
}
