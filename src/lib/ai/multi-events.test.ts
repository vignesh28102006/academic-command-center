import assert from "node:assert";
import {
  processAcademicMessageWithAI,
  processMultipleAcademicEventsWithAI,
  findMatchingItem
} from "../events";
import {
  extractDateString,
  extractMultipleDates,
  resolveRelativeDay,
  toLocalDateString
} from "../dateUtils";
import { parseMultipleAcademicMessages } from "../parser";
import {
  calculateApplicableReminders,
  getEventTargetDate
} from "../reminders/reminderEngine";
import { DEFAULT_REMINDER_SETTINGS } from "../db/reminders";
import { AcademicItem } from "../types";

console.log("=====================================================================");
console.log("RUNNING MULTIPLE EVENTS & MULTIPLE RELATIVE DATES TEST SUITE (PHASE 4B)");
console.log("=====================================================================\n");

// Reference date for tests: Friday, September 25, 2026 at 09:00:00 IST
const REF_DATE = new Date("2026-09-25T09:00:00+05:30");

async function runAllMultiEventTests() {
  // ---------------------------------------------------------------------------
  // TEST 1: One event with one date
  // ---------------------------------------------------------------------------
  console.log("--- Test 1: One event with one date ---");
  {
    const text = "Assignment 1 is due tomorrow at 5 PM.";
    const result = await processAcademicMessageWithAI(text, [], {
      referenceDate: REF_DATE,
      timezone: "Asia/Kolkata"
    });

  assert.strictEqual(result.action, "CREATED", "Action should be CREATED");
  assert.ok(result.items, "Should return items array");
  assert.strictEqual(result.items.length, 1, "Single-event message must produce exactly 1 event");
  assert.ok(result.item, "Should retain backward-compatible .item property");
  assert.strictEqual(result.item.id, result.items[0].id, "item must point to primary item");
  assert.strictEqual(result.item.eventDate, "2026-09-26", "Tomorrow from Sep 25 should be 2026-09-26");
  console.log("✓ Test 1 passed: One event with one date produces exactly 1 event occurrence");
}

// ---------------------------------------------------------------------------
// TEST 2: One message containing two exam dates
// ---------------------------------------------------------------------------
console.log("\n--- Test 2: One message containing two exam dates ---");
{
  const text = "Internal exams are next Tuesday and next Thursday.";
  const result = await processAcademicMessageWithAI(text, [], {
    referenceDate: REF_DATE,
    timezone: "Asia/Kolkata"
  });

  assert.strictEqual(result.action, "CREATED", "Action should be CREATED");
  assert.ok(result.items, "Should return items array");
  assert.strictEqual(result.items.length, 2, "Must produce exactly 2 events (NOT 1)");

  const [event1, event2] = result.items;

  // Verify dates
  // From Friday Sep 25, 2026: next Tuesday is Sep 29, next Thursday is Oct 01
  assert.strictEqual(event1.eventDate, "2026-09-29", "First exam must be on Tuesday 2026-09-29");
  assert.strictEqual(event2.eventDate, "2026-10-01", "Second exam must be on Thursday 2026-10-01");

  // Verify titles preserve shared context
  assert.ok(event1.title.includes("Tuesday"), "Event 1 title should preserve Tuesday context");
  assert.ok(event2.title.includes("Thursday"), "Event 2 title should preserve Thursday context");

  // Verify distinct identities
  assert.notStrictEqual(event1.id, event2.id, "Events must have distinct identities");
  assert.strictEqual(event1.type, "EXAM");
  assert.strictEqual(event2.type, "EXAM");
  console.log("✓ Test 2 passed: One message containing two exam dates produces 2 separate events");
}

// ---------------------------------------------------------------------------
// TEST 3: One message containing three exam dates
// ---------------------------------------------------------------------------
console.log("\n--- Test 3: One message containing three exam dates ---");
{
  const text = "Internal exams next Tuesday, Thursday and Saturday.";
  const result = await processAcademicMessageWithAI(text, [], {
    referenceDate: REF_DATE,
    timezone: "Asia/Kolkata"
  });

  assert.ok(result.items, "Should return items array");
  assert.strictEqual(result.items.length, 3, "Must produce exactly 3 exam occurrences");

  const [e1, e2, e3] = result.items;
  assert.strictEqual(e1.eventDate, "2026-09-29", "First exam Tuesday 2026-09-29");
  assert.strictEqual(e2.eventDate, "2026-10-01", "Second exam Thursday 2026-10-01");
  assert.strictEqual(e3.eventDate, "2026-10-03", "Third exam Saturday 2026-10-03");

  // Ensure chronological ordering within exam week
  assert.ok(e1.eventDate < e2.eventDate, "Exam 1 < Exam 2");
  assert.ok(e2.eventDate < e3.eventDate, "Exam 2 < Exam 3");

  // Distinct IDs
  const idSet = new Set(result.items.map(e => e.id));
  assert.strictEqual(idSet.size, 3, "All 3 exam items must have distinct IDs");
  console.log("✓ Test 3 passed: One message containing three exam dates produces 3 separate events");
}

// ---------------------------------------------------------------------------
// TEST 4: Two different subjects with two dates
// ---------------------------------------------------------------------------
console.log("\n--- Test 4: Two different subjects with two dates ---");
{
  const text = "OS exam next Tuesday and DBMS exam next Thursday.";
  const result = await processAcademicMessageWithAI(text, [], {
    referenceDate: REF_DATE,
    timezone: "Asia/Kolkata"
  });

  assert.ok(result.items, "Should return items array");
  assert.strictEqual(result.items.length, 2, "Must produce 2 separate subject events");

  const [osEvent, dbmsEvent] = result.items;

  assert.strictEqual(osEvent.subject, "OS", "Event 1 subject must be OS");
  assert.strictEqual(osEvent.eventDate, "2026-09-29", "OS exam date must be Tuesday 2026-09-29");
  assert.ok(osEvent.title.toLowerCase().includes("os"), "Event 1 title should mention OS");

  assert.strictEqual(dbmsEvent.subject, "DBMS", "Event 2 subject must be DBMS");
  assert.strictEqual(dbmsEvent.eventDate, "2026-10-01", "DBMS exam date must be Thursday 2026-10-01");
  assert.ok(dbmsEvent.title.toLowerCase().includes("dbms"), "Event 2 title should mention DBMS");
  console.log("✓ Test 4 passed: Two different subjects with two dates parsed with distinct subjects and dates");
}

// ---------------------------------------------------------------------------
// TEST 5: Relative dates resolution (tomorrow, next Tuesday, next Thursday)
// ---------------------------------------------------------------------------
console.log("\n--- Test 5: Relative dates resolution ---");
{
  // Friday Sep 25, 2026
  const tomorrow = extractDateString("Submit tomorrow by 5 PM", REF_DATE);
  assert.ok(tomorrow, "Tomorrow should be extracted");
  assert.strictEqual(tomorrow.dateStr, "2026-09-26", "Tomorrow must be 2026-09-26");

  const nextTue = extractDateString("Exam is next Tuesday", REF_DATE);
  assert.ok(nextTue, "Next Tuesday should be extracted");
  assert.strictEqual(nextTue.dateStr, "2026-09-29", "Next Tuesday must be 2026-09-29");

  const nextThu = extractDateString("Exam is next Thursday", REF_DATE);
  assert.ok(nextThu, "Next Thursday should be extracted");
  assert.strictEqual(nextThu.dateStr, "2026-10-01", "Next Thursday must be 2026-10-01");
  console.log("✓ Test 5 passed: Relative dates 'tomorrow', 'next Tuesday', 'next Thursday' resolved accurately");
}

// ---------------------------------------------------------------------------
// TEST 6: Relative dates crossing month boundaries
// ---------------------------------------------------------------------------
console.log("\n--- Test 6: Relative dates crossing month boundaries ---");
{
  // Sep 25 (Friday) -> next Thursday is Oct 01 (month changes from 09 to 10)
  const d = resolveRelativeDay("thursday", REF_DATE, "next");
  const dStr = toLocalDateString(d);

  assert.strictEqual(dStr, "2026-10-01", "Crossing boundary: Sep 25 + 6 days must be 2026-10-01");
  assert.strictEqual(d.getMonth(), 9, "Month index 9 is October");
  assert.strictEqual(d.getDate(), 1, "Day of month must be 1");
  console.log("✓ Test 6 passed: Month boundary correctly crossed from September (30 days) into October");
}

// ---------------------------------------------------------------------------
// TEST 7: Multiple event times
// ---------------------------------------------------------------------------
console.log("\n--- Test 7: Multiple event times ---");
{
  const text = "Lab exams are on Tuesday at 10 AM and Thursday at 2 PM.";
  const result = await processAcademicMessageWithAI(text, [], {
    referenceDate: REF_DATE,
    timezone: "Asia/Kolkata"
  });

  assert.ok(result.items, "Should return items array");
  assert.strictEqual(result.items.length, 2, "Must produce 2 lab exam events");

  const [lab1, lab2] = result.items;
  assert.strictEqual(lab1.eventDate, "2026-09-29", "Tuesday date");
  assert.strictEqual(lab1.eventTime, "10:00 AM", "Tuesday time 10:00 AM");

  assert.strictEqual(lab2.eventDate, "2026-10-01", "Thursday date");
  assert.strictEqual(lab2.eventTime, "2:00 PM", "Thursday time 2:00 PM");
  console.log("✓ Test 7 passed: Multiple event times (10 AM and 2 PM) preserved on their respective occurrences");
}

// ---------------------------------------------------------------------------
// TEST 8: Duplicate multi-event message
// ---------------------------------------------------------------------------
console.log("\n--- Test 8: Duplicate multi-event message ---");
{
  const text = "Exams are next Tuesday and next Thursday.";

  // First ingestion
  const firstResult = await processAcademicMessageWithAI(text, [], {
    referenceDate: REF_DATE,
    timezone: "Asia/Kolkata"
  });
  assert.strictEqual(firstResult.action, "CREATED");
  assert.strictEqual(firstResult.items?.length, 2);

  const existingItems = firstResult.items!;

  // Second ingestion with same raw message
  const duplicateResult = await processAcademicMessageWithAI(text, existingItems, {
    referenceDate: REF_DATE,
    timezone: "Asia/Kolkata"
  });

  assert.strictEqual(
    duplicateResult.action,
    "IGNORED_DUPLICATE",
    "Duplicate message must be detected and ignored without creating duplicate events"
  );
  console.log("✓ Test 8 passed: Duplicate multi-event message detected and safely ignored");
}

// ---------------------------------------------------------------------------
// TEST 9: Postponement of one event from a multi-event message
// ---------------------------------------------------------------------------
console.log("\n--- Test 9: Postponement of one event from a multi-event message ---");
{
  // Setup existing items from prior multi-event message
  const eventTue: AcademicItem = {
    id: "item-tue",
    title: "Exam — Tuesday",
    subject: "NEEDS_CONFIRMATION",
    type: "EXAM",
    status: "INBOX",
    eventDate: "2026-09-29",
    resourceUrls: [],
    attachmentNames: [],
    description: "Exams are next Tuesday and next Thursday.",
    originalMessages: ["Exams are next Tuesday and next Thursday."],
    createdAt: REF_DATE.toISOString(),
    updatedAt: REF_DATE.toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  };

  const eventThu: AcademicItem = {
    id: "item-thu",
    title: "Exam — Thursday",
    subject: "NEEDS_CONFIRMATION",
    type: "EXAM",
    status: "INBOX",
    eventDate: "2026-10-01",
    resourceUrls: [],
    attachmentNames: [],
    description: "Exams are next Tuesday and next Thursday.",
    originalMessages: ["Exams are next Tuesday and next Thursday."],
    createdAt: REF_DATE.toISOString(),
    updatedAt: REF_DATE.toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  };

  const existingItems = [eventTue, eventThu];

  // Postponement message specifically targeting Tuesday
  const postponeMessage = "The exam originally scheduled next Tuesday is postponed to next Friday.";
  const postponeResult = await processAcademicMessageWithAI(postponeMessage, existingItems, {
    referenceDate: REF_DATE,
    timezone: "Asia/Kolkata"
  });

  assert.strictEqual(postponeResult.action, "UPDATED", "Action should be UPDATED");
  assert.ok(postponeResult.item, "Should return updated item");
  assert.strictEqual(postponeResult.updatedItemId, "item-tue", "Must update only the Tuesday exam");

  // Verify Tuesday exam was postponed to next Friday (2026-10-02)
  assert.strictEqual(postponeResult.item.eventDate, "2026-10-02", "Date should be updated to 2026-10-02");
  assert.strictEqual(postponeResult.item.status, "POSTPONED", "Status should be POSTPONED");
  assert.ok(postponeResult.item.changeHistory.length > 0, "Audit trail recorded");

  // Verify Thursday exam was not touched
  assert.strictEqual(eventThu.eventDate, "2026-10-01", "Thursday exam must remain untouched");
  assert.strictEqual(eventThu.status, "INBOX", "Thursday exam status untouched");
  console.log("✓ Test 9 passed: Postponement of Tuesday exam updated only that occurrence without affecting Thursday");
}

// ---------------------------------------------------------------------------
// TEST 10: Reminder generation for each extracted event
// ---------------------------------------------------------------------------
console.log("\n--- Test 10: Reminder generation for each extracted event ---");
{
  const eventTue: AcademicItem = {
    id: "exam-tue-123",
    title: "Internal Exam — Tuesday",
    subject: "FoDS",
    type: "EXAM",
    status: "INBOX",
    eventDate: "2026-09-29",
    eventTime: "10:00 AM",
    resourceUrls: [],
    attachmentNames: [],
    description: "Exams next Tuesday and Thursday",
    originalMessages: ["Exams next Tuesday and Thursday"],
    createdAt: REF_DATE.toISOString(),
    updatedAt: REF_DATE.toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  };

  const eventThu: AcademicItem = {
    id: "exam-thu-456",
    title: "Internal Exam — Thursday",
    subject: "FoDS",
    type: "EXAM",
    status: "INBOX",
    eventDate: "2026-10-01",
    eventTime: "10:00 AM",
    resourceUrls: [],
    attachmentNames: [],
    description: "Exams next Tuesday and Thursday",
    originalMessages: ["Exams next Tuesday and Thursday"],
    createdAt: REF_DATE.toISOString(),
    updatedAt: REF_DATE.toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  };

  // Generate reminders independently for each event
  const remindersTue = calculateApplicableReminders(
    eventTue,
    DEFAULT_REMINDER_SETTINGS,
    REF_DATE
  );

  const remindersThu = calculateApplicableReminders(
    eventThu,
    DEFAULT_REMINDER_SETTINGS,
    REF_DATE
  );

  assert.ok(remindersTue.length > 0, "Event Tuesday should have reminders");
  assert.ok(remindersThu.length > 0, "Event Thursday should have reminders");

  // Reminders for Tuesday must have eventId 'exam-tue-123'
  assert.ok(remindersTue.every(r => r.eventId === "exam-tue-123"));
  // Reminders for Thursday must have eventId 'exam-thu-456'
  assert.ok(remindersThu.every(r => r.eventId === "exam-thu-456"));

  // Check 1-day reminder scheduled time
  const oneDayTue = remindersTue.find(r => r.reminderType === "1d");
  const oneDayThu = remindersThu.find(r => r.reminderType === "1d");

  assert.ok(oneDayTue, "Should have 1-day reminder for Tuesday");
  assert.ok(oneDayThu, "Should have 1-day reminder for Thursday");

  // Tuesday exam is 2026-09-29 10:00 AM -> 1-day reminder is 2026-09-28 10:00 AM
  // Thursday exam is 2026-10-01 10:00 AM -> 1-day reminder is 2026-09-30 10:00 AM
  const dateTueReminder = new Date(oneDayTue.scheduledFor).toISOString().slice(0, 10);
  const dateThuReminder = new Date(oneDayThu.scheduledFor).toISOString().slice(0, 10);

  assert.strictEqual(dateTueReminder, "2026-09-28", "Tuesday 1-day reminder is Sep 28");
  assert.strictEqual(dateThuReminder, "2026-09-30", "Thursday 1-day reminder is Sep 30");

  assert.notStrictEqual(
    oneDayTue.scheduledFor,
    oneDayThu.scheduledFor,
    "The two events must have separate reminder schedules based on their respective dates"
  );
  console.log("✓ Test 10 passed: Independent reminder schedules generated for each extracted event");
}

  console.log("\n=====================================================================");
  console.log("ALL 10 MULTIPLE EVENTS & RELATIVE DATES TESTS PASSED CLEANLY! 🎉");
  console.log("=====================================================================\n");
}

runAllMultiEventTests().catch(err => {
  console.error("Test failure:", err);
  process.exit(1);
});
