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
  originalMessages: string[];
  sourceKey?: string;
  notionPageId?: string;
  needsConfirmation?: boolean;
  confidence?: "HIGH" | "MEDIUM" | "NEEDS_CONFIRMATION";
  confidenceScore?: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
  changeHistory: ChangeRecord[];
}

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

export interface CollectorStats {
  endpointStatus: "CONFIGURED" | "AWAITING_SECRET";
  currentGroup?: string | null;
  chatType?: "GROUP" | "PERSONAL" | null;
  collectionStatus?: "ACTIVE" | "PAUSED" | "IGNORED";
  totalReceived: number;
  nonAcademic: number;
  duplicate: number;
  eventsCreated: number;
  eventsUpdated: number;
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