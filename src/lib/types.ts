export type AcademicType =
  | "ASSIGNMENT"
  | "EXAM"
  | "SLIP_TEST"
  | "QUIZ"
  | "LAB"
  | "PROJECT"
  | "PRESENTATION"
  | "COURSE"
  | "ANNOUNCEMENT"
  | "OTHER";

export type AcademicStatus =
  | "INBOX"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "COMPLETED"
  | "POSTPONED"
  | "CANCELLED"
  | "MISSED";

export interface ChangeRecord {
  id: string;
  timestamp: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  summary: string;
  sourceMessage?: string;
  eventId?: string;
  sourceMessageId?: string;
}

export interface AcademicItem {
  id: string;
  title: string;
  subject: string; // If undetermined, "NEEDS_CONFIRMATION"
  type: AcademicType;
  status: AcademicStatus;
  deadline?: string; // ISO string representation (with local offset or timestamp)
  deadlineTime?: string;
  eventDate?: string; // YYYY-MM-DD calendar date (prevents timezone date shifting)
  eventTime?: string; // e.g. "11:35 AM", "First hour", "2:00 PM"
  submissionUrl?: string;
  resourceUrls: string[];
  attachmentNames: string[];
  description: string;
  requirements?: string[];
  sourceGroup?: string;
  sourceSender?: string;
  sourceMessageTimestamp?: string; // ISO 8601 string when WhatsApp message was sent
  sourceMessageDate?: string; // YYYY-MM-DD calendar date when WhatsApp message was sent
  originalMessages: string[];
  sourceKey?: string;
  notionPageId?: string;
  needsConfirmation?: boolean;
  confidence?: "HIGH" | "MEDIUM" | "NEEDS_CONFIRMATION";
  confidenceScore?: number;
  eventVersion?: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
  changeHistory: ChangeRecord[];
}

export * from "./reminders/reminderTypes";

export interface RawMessageRecord {
  id: string;
  source: string;
  sourceGroup?: string;
  sourceSender?: string;
  messageText: string;
  messageTimestamp: string;
  messageHash: string;
  processedAt: string;
  processingStatus: "PROCESSED" | "IGNORED_DUPLICATE" | "NON_ACADEMIC" | "FAILED";
  linkedEventId?: string;
  sourceMessageId?: string;
}

export type CollectorScanStatus =
  | "IDLE"
  | "SCANNING"
  | "COMPLETE"
  | "ERROR"
  | "PERSONAL_IGNORED"
  | "GROUP_NOT_MONITORED"
  | "WHATSAPP_UNAVAILABLE";

export interface CollectorStats {
  endpointStatus: "CONFIGURED" | "AWAITING_SECRET";
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
  eventsCreated: number;
  eventsUpdated: number;
  errors?: number;
  lastProcessedTimestamp?: string | null;
  lastError?: string | null;
  totalReceived: number;
  nonAcademic: number;
  duplicate: number;
  lastReceivedAt: string | null;
  lastProcessedMessage: string | null;
  lastResult: string | null;
}

export interface SubjectMappingRecord {
  id: string;
  courseCode: string;
  subjectName: string;
  createdAt: string;
  updatedAt: string;
}

export type ParseAction = "CREATED" | "UPDATED" | "IGNORED_DUPLICATE" | "NON_ACADEMIC";

export interface ParseResult {
  action: ParseAction;
  item?: AcademicItem;
  updatedItemId?: string;
  changeSummary?: string;
  reason?: string;
  confidence?: "HIGH" | "MEDIUM" | "NEEDS_CONFIRMATION";
}

export interface CollectorGroupState {
  id: string;
  groupName: string;
  groupIdentifier: string;
  firstBackfillDate: string;
  // Scanning progress cursor (advances on examined, ignored, and processed messages)
  lastScannedMessageTimestamp?: string | null;
  lastScannedMessageId?: string | null;
  // Academic event processing cursor (advances only when academic events are processed)
  lastProcessedAcademicMessageTimestamp?: string | null;
  lastProcessedAcademicMessageId?: string | null;
  // Backward compatibility aliases
  lastProcessedMessageTimestamp?: string | null;
  lastProcessedMessageId?: string | null;
  lastScanTime?: string | null;
  lastSuccessfulScanTime?: string | null;
  backfillComplete: boolean;
  status: "IDLE" | "DISCOVERING_GROUPS" | "BACKFILLING" | "MONITORING" | "SCANNING" | "PAUSED" | "ERROR" | "WHATSAPP_UNAVAILABLE";
  messagesScanned: number;
  messagesProcessed: number;
  messagesIgnored: number;
  messagesFailed?: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectorScanHistory {
  id: string;
  startedAt: string;
  completedAt?: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  groupsDiscovered: number;
  groupsCompleted: number;
  groupsFailed: number;
  messagesScanned: number;
  messagesProcessed: number;
  messagesIgnored: number;
  eventsCreated: number;
  eventsUpdated: number;
  error?: string | null;
  createdAt: string;
}