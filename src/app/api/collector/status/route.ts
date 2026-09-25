import { NextResponse } from "next/server";
import { getCollectorStats, updateCollectorChatState } from "@/lib/collector/stats";
import { getAllCollectorGroups, getRecentScans } from "@/lib/db/collectorState";
import { verifyCollectorAuth } from "@/lib/collector/auth";

export const dynamic = "force-dynamic";

let lastHeartbeatAt: string | null = null;
let isWhatsAppExplicitlyUnavailable = false;

export async function GET() {
  const stats = getCollectorStats();
  const groups = await getAllCollectorGroups();
  const recentScans = await getRecentScans(10);

  const lastScan = recentScans.length > 0 ? recentScans[0] : null;

  // Determine WhatsApp availability
  // Available if we had a heartbeat within the last 5 minutes and not explicitly marked unavailable
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const hasRecentHeartbeat = Boolean(lastHeartbeatAt && new Date(lastHeartbeatAt).getTime() > fiveMinutesAgo);
  const whatsappStatus = (hasRecentHeartbeat && !isWhatsAppExplicitlyUnavailable) ? "CONNECTED" : "UNAVAILABLE";

  // Calculate next scan: 2 hours after last scan (or now + 2 hours if no scans yet)
  const lastScanTime = lastScan?.startedAt ? new Date(lastScan.startedAt).getTime() : Date.now();
  const nextScanTimestamp = new Date(lastScanTime + 2 * 60 * 60 * 1000).toISOString();

  // Aggregate group metrics
  let totalDiscovered = groups.length;
  let totalCompleted = groups.filter(g => g.backfillComplete).length;
  let totalFailed = groups.filter(g => g.status === "ERROR" || g.lastError).length;
  let totalMessagesScanned = groups.reduce((acc, g) => acc + (g.messagesScanned || 0), 0);
  let totalMessagesProcessed = groups.reduce((acc, g) => acc + (g.messagesProcessed || 0), 0);
  let totalMessagesIgnored = groups.reduce((acc, g) => acc + (g.messagesIgnored || 0), 0);

  return NextResponse.json({
    status: "ok",
    stats,
    whatsappStatus,
    lastHeartbeatAt,
    lastScan: lastScan ? {
      id: lastScan.id,
      startedAt: lastScan.startedAt,
      completedAt: lastScan.completedAt,
      status: lastScan.status,
      durationSeconds: lastScan.completedAt
        ? Math.round((new Date(lastScan.completedAt).getTime() - new Date(lastScan.startedAt).getTime()) / 1000)
        : null
    } : null,
    nextScan: nextScanTimestamp,
    groupsDiscovered: totalDiscovered,
    groupsCompleted: totalCompleted,
    groupsFailed: totalFailed,
    messagesScanned: totalMessagesScanned,
    messagesProcessed: totalMessagesProcessed,
    messagesIgnored: totalMessagesIgnored,
    eventsCreated: stats.eventsCreated,
    eventsUpdated: stats.eventsUpdated,
    groups,
    recentScans
  });
}

export async function POST(request: Request) {
  try {
    const auth = verifyCollectorAuth(request);
    if (!auth.authorized) {
      return auth.response!;
    }

    const body = await request.json().catch(() => ({}));
    lastHeartbeatAt = new Date().toISOString();

    if (body.whatsappAvailable !== undefined) {
      isWhatsAppExplicitlyUnavailable = !body.whatsappAvailable;
    }

    updateCollectorChatState({
      currentGroup: body.currentGroup,
      chatType: body.chatType,
      collectionStatus: body.collectionStatus
    });

    return NextResponse.json({
      status: "ok",
      stats: getCollectorStats(),
      lastHeartbeatAt
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update collector status." },
      { status: 500 }
    );
  }
}
