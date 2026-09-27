import { NextResponse } from "next/server";
import { resetCollectorGroupBackfill, getCollectorGroupByRef } from "@/lib/db/collectorState";
import { verifyCollectorAuth } from "@/lib/collector/auth";

export const dynamic = "force-dynamic";

/**
 * Development / Admin API: Reset a group's backfill status and scanning cursor.
 * Clears lastScannedMessageTimestamp and sets backfillComplete = false,
 * allowing a fresh scan from September 10, 2026.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  // Allow authorized collectors or requests with valid auth header
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const auth = verifyCollectorAuth(request);
    if (!auth.authorized) {
      return auth.response!;
    }
  }

  const { id } = await Promise.resolve(params);
  const existing = await getCollectorGroupByRef(id);
  if (!existing) {
    return NextResponse.json(
      { error: `Group '${id}' not found.` },
      { status: 404 }
    );
  }

  const resetGroup = await resetCollectorGroupBackfill(id);

  return NextResponse.json({
    status: "ok",
    message: `Backfill successfully reset for group '${existing.groupName}'. The next scan will restart from September 10, 2026.`,
    group: resetGroup
  });
}
