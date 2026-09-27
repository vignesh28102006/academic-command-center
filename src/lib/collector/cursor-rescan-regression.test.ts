import assert from "node:assert";
import { executeManualGroupScan, GroupCursorState, RawScanMessage } from "./manual-scan";
import { parseAcademicMessage } from "../parser";
import { parseMultipleAcademicMessages } from "../parser";
import { processAcademicMessage } from "../events";
import { calculateApplicableReminders } from "../reminders/reminderEngine";
import { ReminderSettings } from "../reminders/reminderTypes";
import { formatTimeDeterministic, formatDateTimeDeterministic } from "../dateUtils";
import { AcademicItem } from "../types";

async function runRegressionSuite() {
  console.log("=== RUNNING CURSOR, MULTI-EVENT, TOC REGEX, & HYDRATION REGRESSION TESTS ===");

  const groupName = "23CSE351 FoDS G1";
  const group2Name = "Machine Learning CSE-C";

  // =========================================================================
  // Requirement 25: CURSOR TESTS A - J
  // =========================================================================
  console.log("\n--- Requirement 25: Cursor Tests A - J ---");

  // Test A & B & C: First scan from September 10, completes, and persists lastScannedMessageTimestamp
  let persistedCursor: any = null;
  const initialMessages: RawScanMessage[] = [
    {
      id: "pre_sept10",
      text: "Old announcement before Sept 10",
      timestamp: "2026-09-08T10:00:00+05:30" // pre-September 10
    },
    {
      id: "msg_chatter_1",
      text: "Good morning all 🙏",
      timestamp: "2026-09-11T09:00:00+05:30" // chatter ignored
    },
    {
      id: "msg_academic_1",
      text: "FoDS Quiz 1 scheduled on September 25",
      timestamp: "2026-09-14T11:00:00+05:30" // academic processed
    },
    {
      id: "msg_chatter_2",
      text: "Noted thanks",
      timestamp: "2026-09-18T14:30:00+05:30" // chatter ignored
    }
  ];

  const processedMessagesBatch1: string[] = [];

  const scan1Stats = await executeManualGroupScan({
    groupName,
    messages: initialMessages,
    sendMessage: async (p) => {
      processedMessagesBatch1.push(p.message);
      return { action: "CREATED" };
    },
    updateCursor: async (c) => {
      persistedCursor = c;
    }
  });

  assert.strictEqual(scan1Stats.scanStatus, "COMPLETE", "Scan 1 must complete");
  assert.strictEqual(scan1Stats.academicMessages, 1, "Only 1 academic message processed");
  assert.strictEqual(scan1Stats.messagesIgnored, 3, "Pre-boundary + 2 chatter messages ignored");
  assert.ok(persistedCursor, "Cursor must be persisted on completion");
  assert.strictEqual(persistedCursor.backfillComplete, true, "Backfill must be marked COMPLETE");
  assert.strictEqual(persistedCursor.lastScannedMessageTimestamp, "2026-09-18T14:30:00+05:30", "Scan cursor must advance to the latest examined message (even if ignored)");
  assert.strictEqual(persistedCursor.lastProcessedAcademicMessageTimestamp, "2026-09-14T11:00:00+05:30", "Academic cursor must be at the academic event message");
  console.log("✓ Test A, B, C passed: First scan completes and persists separate scan and academic cursors");

  // Test D & E: Reopening the same group does NOT rescan from September 10, and old ignored messages are skipped
  const processedMessagesBatch2: string[] = [];
  const cursorStateForReopen: GroupCursorState = {
    groupName,
    lastScannedMessageTimestamp: persistedCursor.lastScannedMessageTimestamp,
    lastScannedMessageId: persistedCursor.lastScannedMessageId,
    lastProcessedAcademicMessageTimestamp: persistedCursor.lastProcessedAcademicMessageTimestamp,
    lastProcessedAcademicMessageId: persistedCursor.lastProcessedAcademicMessageId,
    backfillComplete: true
  };

  const scan2Stats = await executeManualGroupScan({
    groupName,
    cursorState: cursorStateForReopen,
    messages: initialMessages, // Same messages re-encountered
    sendMessage: async (p) => {
      processedMessagesBatch2.push(p.message);
      return { action: "CREATED" };
    }
  });

  assert.strictEqual(scan2Stats.scanStatus, "COMPLETE");
  assert.strictEqual(processedMessagesBatch2.length, 0, "No messages from the first scan should be re-sent to backend");
  assert.strictEqual(scan2Stats.academicMessages, 0, "Zero academic messages re-processed");
  console.log("✓ Test D & E passed: Reopening group does NOT rescan old messages or chatter");

  // Test F: New message after cursor gets processed
  const processedMessagesBatch3: string[] = [];
  let updatedCursorBatch3: any = null;
  const newMessages: RawScanMessage[] = [
    ...initialMessages,
    {
      id: "msg_new_academic",
      text: "FoDS Assignment 2 due 2 October at 11:59 PM",
      timestamp: "2026-09-22T16:00:00+05:30" // Newer than cursor
    }
  ];

  const scan3Stats = await executeManualGroupScan({
    groupName,
    cursorState: cursorStateForReopen,
    messages: newMessages,
    sendMessage: async (p) => {
      processedMessagesBatch3.push(p.message);
      return { action: "CREATED" };
    },
    updateCursor: async (c) => {
      updatedCursorBatch3 = c;
    }
  });

  assert.strictEqual(processedMessagesBatch3.length, 1, "Only the 1 new message should be processed");
  assert.ok(processedMessagesBatch3[0].includes("FoDS Assignment 2"));
  assert.strictEqual(scan3Stats.academicMessages, 1);
  assert.strictEqual(updatedCursorBatch3.lastScannedMessageTimestamp, "2026-09-22T16:00:00+05:30");
  assert.strictEqual(updatedCursorBatch3.lastProcessedAcademicMessageTimestamp, "2026-09-22T16:00:00+05:30");
  console.log("✓ Test F passed: New message after cursor is exclusively processed");

  // Test G: Ignored message advances cursor
  let updatedCursorBatch4: any = null;
  const ignoredMessageRun: RawScanMessage[] = [
    {
      id: "msg_attendance",
      text: "Lab absentees in tue 08,10,19,22,28,29,33,04,38",
      timestamp: "2026-09-23T10:00:00+05:30"
    }
  ];

  await executeManualGroupScan({
    groupName,
    cursorState: updatedCursorBatch3,
    messages: ignoredMessageRun,
    sendMessage: async () => ({ action: "NON_ACADEMIC" }),
    updateCursor: async (c) => {
      updatedCursorBatch4 = c;
    }
  });

  assert.strictEqual(updatedCursorBatch4.lastScannedMessageTimestamp, "2026-09-23T10:00:00+05:30", "Scan cursor MUST advance even for ignored attendance messages");
  console.log("✓ Test G passed: Ignored message advances the scan cursor");

  // Test H: Duplicate message advances safely
  let updatedCursorBatch5: any = null;
  const duplicateRun: RawScanMessage[] = [
    {
      id: "msg_dup",
      text: "FoDS Assignment 2 due 2 October at 11:59 PM",
      timestamp: "2026-09-24T12:00:00+05:30"
    }
  ];

  await executeManualGroupScan({
    groupName,
    cursorState: updatedCursorBatch4,
    messages: duplicateRun,
    sendMessage: async () => ({ action: "IGNORED_DUPLICATE" }),
    updateCursor: async (c) => {
      updatedCursorBatch5 = c;
    }
  });

  assert.strictEqual(updatedCursorBatch5.lastScannedMessageTimestamp, "2026-09-24T12:00:00+05:30", "Scan cursor MUST advance past duplicates");
  console.log("✓ Test H passed: Duplicate message advances scan cursor safely");

  // Test I: Failed message holds cursor
  let errorCursorRecorded: any = null;
  const failureRun: RawScanMessage[] = [
    {
      id: "msg_ok_before_fail",
      text: "Quiz 3 announced for 5 October",
      timestamp: "2026-09-25T09:00:00+05:30"
    },
    {
      id: "msg_that_fails",
      text: "Submission link is live",
      timestamp: "2026-09-25T11:00:00+05:30"
    },
    {
      id: "msg_unreached",
      text: "Class cancelled",
      timestamp: "2026-09-25T15:00:00+05:30"
    }
  ];

  const failStats = await executeManualGroupScan({
    groupName,
    cursorState: updatedCursorBatch5,
    messages: failureRun,
    sendMessage: async (p) => {
      if (p.sourceMessageId === "msg_that_fails") {
        throw new Error("Simulated 500 Network Failure");
      }
      return { action: "CREATED" };
    },
    updateCursor: async (c) => {
      errorCursorRecorded = c;
    }
  });

  assert.strictEqual(failStats.scanStatus, "ERROR");
  assert.strictEqual(errorCursorRecorded.status, "ERROR");
  assert.strictEqual(errorCursorRecorded.lastScannedMessageTimestamp, "2026-09-25T09:00:00+05:30", "Cursor must be held at the last successful message and NOT advance past msg_that_fails");
  console.log("✓ Test I passed: Failed message holds cursor for retry without advancing");

  // Test J: Switching groups uses separate cursors
  let group2CursorRecorded: any = null;
  const group2Messages: RawScanMessage[] = [
    {
      id: "g2_m1",
      text: "Machine Learning Lab 1 submission due 28 September",
      timestamp: "2026-09-20T10:00:00+05:30"
    }
  ];

  await executeManualGroupScan({
    groupName: group2Name,
    cursorState: null, // Group 2 starts fresh
    messages: group2Messages,
    sendMessage: async () => ({ action: "CREATED" }),
    updateCursor: async (c) => {
      group2CursorRecorded = c;
    }
  });

  assert.strictEqual(group2CursorRecorded.groupName, group2Name);
  assert.strictEqual(group2CursorRecorded.lastScannedMessageTimestamp, "2026-09-20T10:00:00+05:30");
  assert.notStrictEqual(group2CursorRecorded.lastScannedMessageTimestamp, errorCursorRecorded.lastScannedMessageTimestamp);
  console.log("✓ Test J passed: Separate groups maintain strictly independent cursors");

  // =========================================================================
  // Requirement 27: TOC PARSER REGEX REGRESSION TEST
  // =========================================================================
  console.log("\n--- Requirement 27: TOC Parser Regex Regression ---");
  const problematicTocMessage = "Quiz 2 - scheduled on oct 5 - portions ...";
  
  // Must parse cleanly without throwing "Invalid regular expression: Unterminated group"
  let parsedItem: any = null;
  assert.doesNotThrow(() => {
    parsedItem = parseAcademicMessage(problematicTocMessage, {
      sourceGroup: "TOC 23CSE303 - CSE-C",
      sourceMessageTimestamp: "2026-09-20T10:00:00+05:30"
    });
  }, "Parser must never throw an unescaped regex exception");

  assert.ok(parsedItem, "Expected parsed output");
  assert.strictEqual(parsedItem.type, "QUIZ");
  assert.ok(parsedItem.eventDate?.includes("2026-10-05"), `Expected eventDate 2026-10-05, got ${parsedItem.eventDate}`);
  assert.strictEqual(parsedItem.title, "Quiz 2");
  console.log(`✓ Test 27 passed: Problematic message '${problematicTocMessage}' parsed safely to Quiz 2 on ${parsedItem.eventDate}`);

  // =========================================================================
  // Requirement 12 & 13: RELATIVE DATE BASED ON MESSAGE TIMESTAMP
  // =========================================================================
  console.log("\n--- Requirement 12 & 13: Relative Date Resolution ---");
  // Message sent on Saturday, 19 September 2026: "Quiz is next Tuesday"
  // Next Tuesday relative to 19 Sep 2026 is 22 September 2026
  const relativeMessage = "Quiz is next Tuesday.";
  const msgSentDate = "2026-09-19T14:00:00+05:30";

  const relResult = processAcademicMessage(relativeMessage, [], {
    sourceGroup: "23CSE351 FoDS G1",
    sourceMessageTimestamp: msgSentDate,
    referenceDate: new Date(msgSentDate)
  });

  assert.ok(relResult.item, "Expected event created");
  assert.strictEqual(relResult.item.sourceMessageTimestamp, msgSentDate);
  assert.strictEqual(relResult.item.sourceMessageDate, "2026-09-19");
  assert.ok(
    relResult.item.eventDate?.includes("2026-09-22"),
    `Relative date must anchor on source message date (2026-09-19), resolving 'next Tuesday' to 2026-09-22. Got: ${relResult.item.eventDate}`
  );
  console.log(`✓ Test 12 & 13 passed: Message sent 19 Sep resolved 'next Tuesday' to ${relResult.item.eventDate}`);

  // =========================================================================
  // Requirement 14 & 24: MULTIPLE-DATE EVENT EXTRACTION & REMINDERS
  // =========================================================================
  console.log("\n--- Requirement 14 & 24: Multiple-Date Event Extraction & Reminders ---");
  const multiDateInput = "Quiz 2 Oct 8th and tutorial Oct 15th. Case study Oct 21 and 22.";
  const extractions = parseMultipleAcademicMessages(multiDateInput, {
    sourceGroup: "23CSE351 FoDS G1",
    sourceMessageTimestamp: "2026-09-24T16:32:00+05:30"
  });

  console.log(`  • Extracted ${extractions.length} events from multi-date message`);
  extractions.forEach((ext, i) => {
    console.log(`    Event ${i + 1}: ${ext.title} (${ext.type}) on ${ext.eventDate}`);
  });

  assert.ok(extractions.length >= 4, `Expected at least 4 events extracted, got ${extractions.length}`);

  const hasQuiz8 = extractions.some(e => e.title.includes("Quiz 2") && e.eventDate?.includes("10-08"));
  const hasTut15 = extractions.some(e => e.title.includes("Tutorial") && e.eventDate?.includes("10-15"));
  const hasCase21 = extractions.some(e => e.title.includes("Case Study") && e.eventDate?.includes("10-21"));
  const hasCase22 = extractions.some(e => e.title.includes("Case Study") && e.eventDate?.includes("10-22"));

  assert.ok(hasQuiz8, "Must extract Quiz 2 on Oct 8");
  assert.ok(hasTut15, "Must extract Tutorial on Oct 15");
  assert.ok(hasCase21, "Must extract Case Study on Oct 21");
  assert.ok(hasCase22, "Must extract Case Study on Oct 22");

  // Verify independent reminder scheduling (Requirement 20 & 21)
  // Reminder engine must anchor on eventDate / deadline, NOT on sourceMessageTimestamp
  const nowForReminder = new Date("2026-09-25T10:00:00+05:30");
  const testSettings: ReminderSettings = {
    id: "default",
    enabled: true,
    deadline_reminders_enabled: true,
    exam_reminders_enabled: true,
    morning_briefing_enabled: true,
    morning_briefing_time: "07:30",
    timezone: "Asia/Kolkata",
    default_reminder_intervals: ["7d", "3d", "1d", "3h", "1h"],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  for (const ext of extractions) {
    const dummyItem: AcademicItem = {
      id: crypto.randomUUID(),
      title: ext.title,
      subject: "FoDS",
      type: ext.type,
      status: "INBOX",
      eventDate: ext.eventDate,
      sourceMessageTimestamp: "2026-09-24T16:32:00+05:30",
      sourceMessageDate: "2026-09-24",
      resourceUrls: [],
      attachmentNames: [],
      description: ext.description || ext.title,
      originalMessages: [multiDateInput],
      createdAt: "2026-09-24T16:32:00+05:30",
      updatedAt: "2026-09-24T16:32:00+05:30",
      changeHistory: [],
      confidence: "HIGH"
    };

    const reminders = calculateApplicableReminders(dummyItem, testSettings, nowForReminder);
    assert.ok(reminders.length > 0, `Expected reminders generated for ${dummyItem.title}`);
    
    // Each reminder's scheduledFor date must be calculated relative to eventDate (Oct 8, 15, 21, 22), not Sep 24!
    for (const r of reminders) {
      const scheduledTime = new Date(r.scheduledFor).getTime();
      const messageSentTime = new Date("2026-09-24T16:32:00+05:30").getTime();
      assert.ok(scheduledTime > messageSentTime, `Reminder scheduled date (${r.scheduledFor}) must be ahead of message sent date (2026-09-24)`);
    }
  }
  console.log("✓ Test 14 & 24 passed: Multi-event extracts 4 distinct events with independent reminder schedules");

  // =========================================================================
  // Requirement 28: HYDRATION-SAFE DETERMINISTIC FORMATTING
  // =========================================================================
  console.log("\n--- Requirement 28: Hydration Deterministic Formatting ---");
  const testIso = "2026-09-27T11:35:00";
  const d = new Date(testIso);
  const formattedTime = formatTimeDeterministic(d);
  const formattedDateTime = formatDateTimeDeterministic(d);

  assert.strictEqual(formattedTime, "11:35 AM", "Time must strictly match '11:35 AM' without locale casing drift");
  assert.ok(formattedDateTime.includes("27 Sep 2026, 11:35 AM"), `DateTime must strictly format deterministically, got: ${formattedDateTime}`);
  console.log(`✓ Test 28 passed: Formatted '${testIso}' to deterministic '${formattedTime}'`);

  console.log("\n============================================================");
  console.log("ALL REGRESSION & CURSOR TESTS PASSED SUCCESSFULLY! ✓✓✓");
  console.log("============================================================\n");
}

runRegressionSuite().catch(err => {
  console.error("Regression test failure:", err);
  process.exit(1);
});
