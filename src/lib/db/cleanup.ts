import { getAllAcademicEvents, deleteAcademicEvent } from "./academicEvents";
import { isGroupAllowed } from "../collector/allowedGroups";
import { isPromotionalMessage, isPureAttendanceMessage } from "../collector/relevanceFilter";
import { AcademicItem } from "../types";

export interface CleanupCandidate {
  event: AcademicItem;
  reason: "DISALLOWED_GROUP" | "PROMOTIONAL_SPAM" | "ATTENDANCE_ONLY";
  detail: string;
}

export interface CleanupResult {
  totalScanned: number;
  candidatesCount: number;
  candidates: {
    id: string;
    title: string;
    subject: string;
    sourceGroup?: string;
    reason: string;
    detail: string;
  }[];
  deletedCount: number;
  dryRun: boolean;
}

/**
 * Identifies events in the database that should not exist:
 * 1. Events from disallowed WhatsApp groups (e.g. Embedded Project Group, random groups)
 * 2. Events that are promotional / commercial advertisements (e.g. "Your Land. Your Legacy... 0% EMI")
 * 3. Events that are pure attendance announcements without exams or assignments.
 * 
 * Legitimate academic events are strictly protected and NEVER flagged.
 */
export async function identifyInvalidAcademicEvents(): Promise<CleanupCandidate[]> {
  const events = await getAllAcademicEvents();
  const candidates: CleanupCandidate[] = [];

  for (const event of events) {
    // 1. Group Allowlist Check
    if (event.sourceGroup && !isGroupAllowed(event.sourceGroup)) {
      candidates.push({
        event,
        reason: "DISALLOWED_GROUP",
        detail: `Originates from unallowed group '${event.sourceGroup}'. Only explicitly allowed groups may create events.`
      });
      continue;
    }

    const textToEvaluate = `${event.title} ${event.description || ""}`.trim();

    // 2. Promotional / Advertisement Check (e.g. "Your Land. Your Legacy...")
    if (isPromotionalMessage(textToEvaluate)) {
      candidates.push({
        event,
        reason: "PROMOTIONAL_SPAM",
        detail: `Matched commercial advertisement or promotional spam patterns.`
      });
      continue;
    }

    // 3. Obvious attendance-only notices
    if (
      isPureAttendanceMessage(textToEvaluate) &&
      event.type !== "ASSIGNMENT" &&
      event.type !== "EXAM" &&
      event.type !== "SLIP_TEST" &&
      event.type !== "QUIZ" &&
      event.type !== "LAB" &&
      event.type !== "PROJECT"
    ) {
      candidates.push({
        event,
        reason: "ATTENDANCE_ONLY",
        detail: `Attendance announcement without actionable academic deadline or exam.`
      });
      continue;
    }
  }

  return candidates;
}

/**
 * Safely removes invalid events identified by identifyInvalidAcademicEvents.
 * If dryRun is true, previews the candidates without modifying the database.
 */
export async function executeCleanupInvalidEvents(dryRun = false): Promise<CleanupResult> {
  const allEvents = await getAllAcademicEvents();
  const candidates = await identifyInvalidAcademicEvents();

  let deletedCount = 0;
  if (!dryRun) {
    for (const candidate of candidates) {
      const ok = await deleteAcademicEvent(candidate.event.id);
      if (ok) {
        deletedCount++;
      }
    }
  }

  return {
    totalScanned: allEvents.length,
    candidatesCount: candidates.length,
    candidates: candidates.map(c => ({
      id: c.event.id,
      title: c.event.title,
      subject: c.event.subject,
      sourceGroup: c.event.sourceGroup,
      reason: c.reason,
      detail: c.detail
    })),
    deletedCount,
    dryRun
  };
}
