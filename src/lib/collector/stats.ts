import { CollectorStats } from "../types";

let stats: CollectorStats = {
  endpointStatus: process.env.COLLECTOR_SECRET ? "CONFIGURED" : "AWAITING_SECRET",
  totalReceived: 0,
  nonAcademic: 0,
  duplicate: 0,
  eventsCreated: 0,
  eventsUpdated: 0,
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

export function recordCollectorMetric(params: {
  message: string;
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
    totalReceived: 0,
    nonAcademic: 0,
    duplicate: 0,
    eventsCreated: 0,
    eventsUpdated: 0,
    lastReceivedAt: null,
    lastProcessedMessage: null,
    lastResult: null
  };
}
