import { NextResponse } from "next/server";
import { getCollectorStats, updateCollectorChatState } from "@/lib/collector/stats";
import { getAllCollectorGroups, getRecentScans } from "@/lib/db/collectorState";
import { verifyCollectorAuth } from "@/lib/collector/auth";
import { ALLOWED_ACADEMIC_GROUPS, isGroupAllowed, normalizeGroupName } from "@/lib/collector/allowedGroups";

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

  // Build canonical groups list from configured allowed groups
  const canonicalGroups = ALLOWED_ACADEMIC_GROUPS.map((allowedName, idx) => {
    const existing = groups.find(g => normalizeGroupName(g.groupName) === normalizeGroupName(allowedName));
    if (existing) {
      return {
        ...existing,
        isAllowed: true
      };
    }
    return {
      id: `allowed-${idx + 1}`,
      groupName: allowedName,
      firstBackfillDate: "2026-09-10",
      lastProcessedMessageTimestamp: null,
      lastProcessedMessageId: null,
      lastScanTime: null,
      backfillComplete: false,
      status: "MONITORING",
      lastError: null,
      messagesScanned: 0,
      messagesProcessed: 0,
      messagesIgnored: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isAllowed: true
    };
  });

  // Also include any legacy groups with isAllowed: false
  const legacyDisallowedGroups = groups
    .filter(g => !isGroupAllowed(g.groupName))
    .map(g => ({ ...g, isAllowed: false }));

  const mergedGroups = [...canonicalGroups, ...legacyDisallowedGroups];

  // Aggregate group metrics
  let totalDiscovered = mergedGroups.length;
  let totalCompleted = mergedGroups.filter(g => g.backfillComplete).length;
  let totalFailed = mergedGroups.filter(g => g.status === "ERROR" || g.lastError).length;
  let totalMessagesScanned = mergedGroups.reduce((acc, g) => acc + (g.messagesScanned || 0), 0);
  let totalMessagesProcessed = mergedGroups.reduce((acc, g) => acc + (g.messagesProcessed || 0), 0);
  let totalMessagesIgnored = mergedGroups.reduce((acc, g) => acc + (g.messagesIgnored || 0), 0);

  return NextResponse.json({
    status: "ok",
    stats,
    whatsappStatus,
    lastHeartbeatAt,
    allowedGroups: ALLOWED_ACADEMIC_GROUPS,
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
    messagesScanned: stats.messagesScanned ?? totalMessagesScanned,
    messagesProcessed: stats.academicMessages ?? totalMessagesProcessed,
    messagesIgnored: stats.messagesIgnored ?? totalMessagesIgnored,
    scanStatus: stats.scanStatus || "IDLE",
    scanStartedAt: stats.scanStartedAt || null,
    scanCompletedAt: stats.scanCompletedAt || null,
    duplicates: stats.duplicates ?? 0,
    errors: stats.errors ?? 0,
    lastProcessedTimestamp: stats.lastProcessedTimestamp || null,
    eventsCreated: stats.eventsCreated,
    eventsUpdated: stats.eventsUpdated,
    groups: mergedGroups,
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
      collectionStatus: body.collectionStatus,
      scanStatus: body.scanStatus,
      scanStartedAt: body.scanStartedAt,
      scanCompletedAt: body.scanCompletedAt,
      messagesScanned: body.messagesScanned,
      academicMessages: body.academicMessages,
      messagesIgnored: body.messagesIgnored,
      duplicates: body.duplicates,
      eventsCreated: body.eventsCreated,
      eventsUpdated: body.eventsUpdated,
      errors: body.errors,
      lastProcessedTimestamp: body.lastProcessedTimestamp,
      lastError: body.lastError
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
