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
}

export interface AcademicItem {
  id: string;
  title: string;
  subject: string; // If undetermined, "NEEDS_CONFIRMATION"
  type: AcademicType;
  status: AcademicStatus;
  deadline?: string; // ISO string representation (with local offset or timestamp)
  eventDate?: string; // YYYY-MM-DD calendar date (prevents timezone date shifting)
  eventTime?: string; // e.g. "11:35 AM", "First hour", "2:00 PM"
  submissionUrl?: string;
  resourceUrls: string[];
  attachmentNames: string[];
  description: string;
  sourceGroup?: string;
  sourceSender?: string;
  originalMessages: string[];
  createdAt: string;
  updatedAt: string;
  changeHistory: ChangeRecord[];
  confidence?: "HIGH" | "MEDIUM" | "NEEDS_CONFIRMATION";
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