import { isMessageEligibleForBackfill, isMessageNewerThanCursor } from "@/lib/dateUtils";
import { classifyAcademicMessage } from "@/lib/collector/relevanceFilter";
import { isGroupAllowed } from "@/lib/collector/allowedGroups";
import { CollectorScanStatus } from "@/lib/types";

export interface RawScanMessage {
  id?: string | null;
  text: string;
  sender?: string | null;
  timestamp: string;
}

export interface GroupCursorState {
  groupName: string;
  lastScannedMessageTimestamp?: string | null;
  lastScannedMessageId?: string | null;
  lastProcessedAcademicMessageTimestamp?: string | null;
  lastProcessedAcademicMessageId?: string | null;
  lastProcessedMessageTimestamp?: string | null;
  lastProcessedMessageId?: string | null;
  backfillComplete?: boolean;
}

export interface ManualScanStats {
  groupName: string;
  scanStatus: CollectorScanStatus;
  scanStartedAt: string | null;
  scanCompletedAt: string | null;
  messagesScanned: number;
  academicMessages: number;
  messagesIgnored: number;
  duplicates: number;
  eventsCreated: number;
  eventsUpdated: number;
  errors: number;
  failedMessageCount: number;
  errorReason: string | null;
  lastProcessedTimestamp: string | null;
  lastScannedTimestamp?: string | null;
  lastProcessedAcademicTimestamp?: string | null;
}

export interface ScanRunOptions {
  groupName: string;
  cursorState?: GroupCursorState | null;
  messages: RawScanMessage[];
  isPersonalChat?: boolean;
  isWhatsAppAvailable?: boolean;
  sendMessage?: (payload: {
    message: string;
    sourceGroup: string;
    sourceSender?: string | null;
    messageTimestamp?: string;
    sourceMessageId?: string | null;
  }) => Promise<{ action: "CREATED" | "UPDATED" | "IGNORED_DUPLICATE" | "NON_ACADEMIC" }>;
  updateCursor?: (payload: {
    groupName: string;
    lastScannedMessageTimestamp?: string | null;
    lastScannedMessageId?: string | null;
    lastProcessedAcademicMessageTimestamp?: string | null;
    lastProcessedAcademicMessageId?: string | null;
    lastProcessedMessageTimestamp?: string | null;
    lastProcessedMessageId?: string | null;
    backfillComplete: boolean;
    status: "MONITORING" | "ERROR";
    lastError?: string | null;
    messagesScannedIncrement: number;
    messagesProcessedIncrement: number;
    messagesIgnoredIncrement: number;
    messagesFailedIncrement?: number;
  }) => Promise<void>;
  onProgress?: (stats: ManualScanStats) => void;
  shouldAbort?: () => boolean;
}

function hashSimple(str: string): string {
  let hash = 0;
  const clean = str.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return String(hash);
}

/**
 * Returns the exact formatted string for the Tampermonkey floating badge pill.
 */
export function getBadgeDisplayText(stats: ManualScanStats): string {
  switch (stats.scanStatus) {
    case "SCANNING":
      return stats.academicMessages > 0
        ? `🟡 ACC Collector: Scanning · ${stats.groupName} · ${stats.academicMessages}`
        : `🟡 ACC Collector: Scanning · ${stats.groupName}`;
    case "COMPLETE":
      return `🟢 ACC Collector: Scan Complete · ${stats.groupName} · ${stats.academicMessages} processed`;
    case "ERROR":
      return `🔴 ACC Collector: Scan Error · ${stats.groupName}`;
    case "PERSONAL_IGNORED":
      return "⚪ ACC Collector: Personal Chat Ignored";
    case "GROUP_NOT_MONITORED":
      return "⚪ ACC Collector: Group Not Monitored";
    case "WHATSAPP_UNAVAILABLE":
      return "🔴 ACC Collector: WhatsApp Unavailable";
    case "IDLE":
    default:
      return "⚪ ACC Collector: Idle";
  }
}

/**
 * Executes a manual scan of messages for an allowed group.
 * 
 * Strict Guarantees:
 * 1. Allowed group opened -> SCANNING
 * 2. Successful scan -> COMPLETE
 * 3. Scan failure -> ERROR
 * 4. Personal chat -> PERSONAL_IGNORED
 * 5. Unallowed group -> GROUP_NOT_MONITORED
 * 6. Backend unavailable -> WHATSAPP_UNAVAILABLE
 * 7. Group switch resets state
 * 8. Completion counter shows current scan only
 * 9. Cursor saved before COMPLETE
 * 10. COMPLETE not shown before backend/Notion processing finishes
 */
export async function executeManualGroupScan(options: ScanRunOptions): Promise<ManualScanStats> {
  const {
    groupName,
    cursorState,
    messages,
    isPersonalChat,
    isWhatsAppAvailable = true,
    sendMessage,
    updateCursor,
    onProgress,
    shouldAbort
  } = options;

  const stats: ManualScanStats = {
    groupName,
    scanStatus: "IDLE",
    scanStartedAt: null,
    scanCompletedAt: null,
    messagesScanned: messages?.length || 0,
    academicMessages: 0,
    messagesIgnored: 0,
    duplicates: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    errors: 0,
    failedMessageCount: 0,
    errorReason: null,
    lastProcessedTimestamp: cursorState?.lastProcessedMessageTimestamp || null
  };

  // State Transition: Backend/WhatsApp connection unavailable
  if (isWhatsAppAvailable === false) {
    stats.scanStatus = "WHATSAPP_UNAVAILABLE";
    stats.errorReason = "WhatsApp Web or backend connection unavailable.";
    onProgress?.(stats);
    return stats;
  }

  // State Transition: Personal 1-to-1 chat opened
  if (isPersonalChat) {
    stats.scanStatus = "PERSONAL_IGNORED";
    onProgress?.(stats);
    return stats;
  }

  // State Transition: Unallowed group opened
  if (!isGroupAllowed(groupName)) {
    stats.scanStatus = "GROUP_NOT_MONITORED";
    onProgress?.(stats);
    return stats;
  }

  // State Transition: Allowed group opened -> SCANNING
  stats.scanStatus = "SCANNING";
  stats.scanStartedAt = new Date().toISOString();
  onProgress?.(stats);

  // Sort messages chronologically
  const sortedMessages = [...messages].sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  // Determine starting cursors
  const scanCursor = cursorState?.lastScannedMessageTimestamp || cursorState?.lastProcessedMessageTimestamp || null;
  let newestScannedTimestamp: string | null = scanCursor;
  let newestScannedId: string | null = cursorState?.lastScannedMessageId || cursorState?.lastProcessedMessageId || null;
  let newestProcessedAcademicTimestamp: string | null = cursorState?.lastProcessedAcademicMessageTimestamp || cursorState?.lastProcessedMessageTimestamp || null;
  let newestProcessedAcademicId: string | null = cursorState?.lastProcessedAcademicMessageId || cursorState?.lastProcessedMessageId || null;
  let scanError: Error | null = null;

  for (const msg of sortedMessages) {
    if (shouldAbort?.()) {
      return stats;
    }

    // 1. September 10 boundary check
    if (!isMessageEligibleForBackfill(msg.timestamp)) {
      stats.messagesIgnored++;
      onProgress?.(stats);
      continue;
    }

    // 2. Cursor check: skip already scanned messages
    if (scanCursor && !isMessageNewerThanCursor(msg.timestamp, scanCursor)) {
      continue;
    }

    // 3. Deduplication check
    const textHash = hashSimple(msg.text);
    if ((msg.id && seenIds.has(msg.id)) || seenHashes.has(textHash)) {
      stats.duplicates++;
      newestScannedTimestamp = msg.timestamp;
      if (msg.id) newestScannedId = msg.id;
      stats.lastScannedTimestamp = msg.timestamp;
      onProgress?.(stats);
      continue;
    }

    if (msg.id) seenIds.add(msg.id);
    seenHashes.add(textHash);

    // 4. Academic Relevance Filter (chatter, attendance-only, advertisements)
    const relevance = classifyAcademicMessage(msg.text);
    if (!relevance.shouldProcess) {
      stats.messagesIgnored++;
      // Ignored messages still advance the scan cursor
      newestScannedTimestamp = msg.timestamp;
      if (msg.id) newestScannedId = msg.id;
      stats.lastScannedTimestamp = msg.timestamp;
      onProgress?.(stats);
      continue;
    }

    // 5. Process Academic Message
    try {
      if (!sendMessage) {
        throw new Error("sendMessage handler not provided");
      }

      const res = await sendMessage({
        message: msg.text,
        sourceGroup: groupName,
        sourceSender: msg.sender,
        messageTimestamp: msg.timestamp,
        sourceMessageId: msg.id
      });

      // Examination succeeded - advance scan cursor
      newestScannedTimestamp = msg.timestamp;
      if (msg.id) newestScannedId = msg.id;
      stats.lastScannedTimestamp = msg.timestamp;

      if (res.action === "CREATED" || res.action === "UPDATED") {
        stats.academicMessages++;
        newestProcessedAcademicTimestamp = msg.timestamp;
        if (msg.id) newestProcessedAcademicId = msg.id;
        stats.lastProcessedAcademicTimestamp = msg.timestamp;
        stats.lastProcessedTimestamp = msg.timestamp;

        if (res.action === "CREATED") {
          stats.eventsCreated++;
        } else {
          stats.eventsUpdated++;
        }
      } else if (res.action === "IGNORED_DUPLICATE") {
        stats.duplicates++;
      } else if (res.action === "NON_ACADEMIC") {
        stats.messagesIgnored++;
      }

      onProgress?.(stats);
    } catch (err: any) {
      stats.errors++;
      stats.failedMessageCount++;
      stats.errorReason = err.message || "Failed to process message";
      scanError = err instanceof Error ? err : new Error(String(err));
      // Strict requirement: DO NOT advance cursor past failed message!
      break;
    }
  }

  if (shouldAbort?.()) {
    return stats;
  }

  // State Transition: Scan failure -> ERROR
  if (scanError) {
    stats.scanStatus = "ERROR";
    if (updateCursor) {
      try {
        await updateCursor({
          groupName,
          lastScannedMessageTimestamp: newestScannedTimestamp,
          lastScannedMessageId: newestScannedId,
          lastProcessedAcademicMessageTimestamp: newestProcessedAcademicTimestamp,
          lastProcessedAcademicMessageId: newestProcessedAcademicId,
          lastProcessedMessageTimestamp: newestProcessedAcademicTimestamp || newestScannedTimestamp,
          lastProcessedMessageId: newestProcessedAcademicId || newestScannedId,
          backfillComplete: cursorState?.backfillComplete || false,
          status: "ERROR",
          lastError: stats.errorReason,
          messagesScannedIncrement: stats.messagesScanned,
          messagesProcessedIncrement: stats.academicMessages,
          messagesIgnoredIncrement: stats.messagesIgnored,
          messagesFailedIncrement: stats.failedMessageCount
        });
      } catch (_) {}
    }
    onProgress?.(stats);
    return stats;
  }

  // Update cursor safely AFTER all processing finishes
  if (updateCursor) {
    await updateCursor({
      groupName,
      lastScannedMessageTimestamp: newestScannedTimestamp,
      lastScannedMessageId: newestScannedId,
      lastProcessedAcademicMessageTimestamp: newestProcessedAcademicTimestamp,
      lastProcessedAcademicMessageId: newestProcessedAcademicId,
      lastProcessedMessageTimestamp: newestProcessedAcademicTimestamp || newestScannedTimestamp,
      lastProcessedMessageId: newestProcessedAcademicId || newestScannedId,
      backfillComplete: true,
      status: "MONITORING",
      lastError: null,
      messagesScannedIncrement: stats.messagesScanned,
      messagesProcessedIncrement: stats.academicMessages,
      messagesIgnoredIncrement: stats.messagesIgnored,
      messagesFailedIncrement: 0
    });
  }

  if (shouldAbort?.()) {
    return stats;
  }

  // State Transition: Scan successful -> COMPLETE
  // Scan Complete ONLY appears after all messages processed and cursor updated
  stats.scanStatus = "COMPLETE";
  stats.scanCompletedAt = new Date().toISOString();
  stats.lastProcessedTimestamp = newestProcessedAcademicTimestamp || newestScannedTimestamp;
  stats.lastScannedTimestamp = newestScannedTimestamp;
  stats.lastProcessedAcademicTimestamp = newestProcessedAcademicTimestamp;
  onProgress?.(stats);

  return stats;
}
