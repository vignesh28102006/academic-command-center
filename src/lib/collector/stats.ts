import { CollectorStats, CollectorScanStatus } from "../types";

let stats: CollectorStats = {
  endpointStatus: process.env.COLLECTOR_SECRET ? "CONFIGURED" : "AWAITING_SECRET",
  currentGroup: null,
  chatType: null,
  collectionStatus: "PAUSED",
  scanStatus: "IDLE",
  scanStartedAt: null,
  scanCompletedAt: null,
  messagesScanned: 0,
  academicMessages: 0,
  messagesIgnored: 0,
  duplicates: 0,
  eventsCreated: 0,
  eventsUpdated: 0,
  errors: 0,
  lastProcessedTimestamp: null,
  lastError: null,
  totalReceived: 0,
  nonAcademic: 0,
  duplicate: 0,
  lastReceivedAt: null,
  lastProcessedMessage: null,
  lastResult: null
};

export function getCollectorStats(): CollectorStats {
  return {
    ...stats,
    endpointStatus: process.env.COLLECTOR_SECRET ? "CONFIGURED" : "AWAITING_SECRET"
  };
}

export function updateCollectorChatState(params: {
  currentGroup?: string | null;
  chatType?: "GROUP" | "PERSONAL" | null;
  collectionStatus?: "ACTIVE" | "PAUSED" | "IGNORED";
  scanStatus?: CollectorScanStatus;
  scanStartedAt?: string | null;
  scanCompletedAt?: string | null;
  messagesScanned?: number;
  academicMessages?: number;
  messagesIgnored?: number;
  duplicates?: number;
  eventsCreated?: number;
  eventsUpdated?: number;
  errors?: number;
  lastProcessedTimestamp?: string | null;
  lastError?: string | null;
}): void {
  if (params.currentGroup !== undefined) {
    stats.currentGroup = params.currentGroup;
  }
  if (params.chatType !== undefined) {
    stats.chatType = params.chatType;
  }
  if (params.collectionStatus !== undefined) {
    stats.collectionStatus = params.collectionStatus;
  }
  if (params.scanStatus !== undefined) {
    stats.scanStatus = params.scanStatus;
  }
  if (params.scanStartedAt !== undefined) {
    stats.scanStartedAt = params.scanStartedAt;
  }
  if (params.scanCompletedAt !== undefined) {
    stats.scanCompletedAt = params.scanCompletedAt;
  }
  if (params.messagesScanned !== undefined) {
    stats.messagesScanned = params.messagesScanned;
  }
  if (params.academicMessages !== undefined) {
    stats.academicMessages = params.academicMessages;
  }
  if (params.messagesIgnored !== undefined) {
    stats.messagesIgnored = params.messagesIgnored;
  }
  if (params.duplicates !== undefined) {
    stats.duplicates = params.duplicates;
  }
  if (params.eventsCreated !== undefined) {
    stats.eventsCreated = params.eventsCreated;
  }
  if (params.eventsUpdated !== undefined) {
    stats.eventsUpdated = params.eventsUpdated;
  }
  if (params.errors !== undefined) {
    stats.errors = params.errors;
  }
  if (params.lastProcessedTimestamp !== undefined) {
    stats.lastProcessedTimestamp = params.lastProcessedTimestamp;
  }
  if (params.lastError !== undefined) {
    stats.lastError = params.lastError;
  }
}

export function recordCollectorMetric(params: {
  message: string;
  sourceGroup?: string;
  result: "CREATED" | "UPDATED" | "IGNORED_DUPLICATE" | "NON_ACADEMIC" | "FAILED";
  receivedAt?: string;
}): void {
  const timestamp = params.receivedAt || new Date().toISOString();
  stats.totalReceived += 1;
  stats.lastReceivedAt = timestamp;
  stats.lastProcessedMessage = params.message.length > 80
    ? params.message.slice(0, 77) + "..."
    : params.message;
  stats.lastResult = params.result;

  if (params.sourceGroup) {
    stats.currentGroup = params.sourceGroup;
    stats.chatType = "GROUP";
    stats.collectionStatus = "ACTIVE";
  }

  if (params.result === "CREATED") {
    stats.eventsCreated += 1;
  } else if (params.result === "UPDATED") {
    stats.eventsUpdated += 1;
  } else if (params.result === "IGNORED_DUPLICATE") {
    stats.duplicate += 1;
  } else if (params.result === "NON_ACADEMIC") {
    stats.nonAcademic += 1;
  }
}

export function resetCollectorStats(): void {
  stats = {
    endpointStatus: process.env.COLLECTOR_SECRET ? "CONFIGURED" : "AWAITING_SECRET",
    currentGroup: null,
    chatType: null,
    collectionStatus: "PAUSED",
    scanStatus: "IDLE",
    scanStartedAt: null,
    scanCompletedAt: null,
    messagesScanned: 0,
    academicMessages: 0,
    messagesIgnored: 0,
    duplicates: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    errors: 0,
    lastProcessedTimestamp: null,
    lastError: null,
    totalReceived: 0,
    nonAcademic: 0,
    duplicate: 0,
    lastReceivedAt: null,
    lastProcessedMessage: null,
    lastResult: null
  };
}
