import assert from "node:assert";
import { AcademicItem } from "../types";
import {
  calculateApplicableReminders,
  generateReminders,
  generateMorningBriefing,
  getEventTargetDate,
  isEventOverdue
} from "./reminderEngine";
import {
  DEFAULT_REMINDER_SETTINGS,
  clearInMemoryReminders,
  createReminder,
  getAllReminders,
  getReminderSettings,
  updateReminderSettings
} from "../db/reminders";
import {
  createAcademicEvent,
  updateAcademicEvent
} from "../db/academicEvents";
import {
  BrowserNotificationProvider,
  MockNotificationProvider,
  setActiveNotificationProvider
} from "./notificationProvider";
import { formatReminderMessage } from "./reminderTemplates";

console.log("============================================================");
console.log("RUNNING PHASE 4B AUTOMATED REMINDERS & MORNING BRIEFING TESTS");
console.log("============================================================\n");

async function runTests() {
  const mockProvider = new MockNotificationProvider();
  setActiveNotificationProvider(mockProvider);

  // Fixed reference date: 2026-09-26 10:00:00 AM Asia/Kolkata
  const baseDate = new Date("2026-09-26T10:00:00+05:30");

  clearInMemoryReminders();

  // ---------------------------------------------------------------------------
  // Test 1: Deadline reminder generated for Assignment
  // ---------------------------------------------------------------------------
  const item1: AcademicItem = {
    id: "test-assignment-1",
    title: "OS Assignment 2",
    subject: "OS",
    type: "ASSIGNMENT",
    status: "IN_PROGRESS",
    deadline: "2026-10-06T23:59:00+05:30",
    submissionUrl: "https://forms.gle/os-test",
    resourceUrls: [],
    attachmentNames: [],
    description: "OS Process Scheduling",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const rems1 = calculateApplicableReminders(item1, DEFAULT_REMINDER_SETTINGS, baseDate);
  assert.ok(rems1.length > 0, "Test 1: Assignment should generate reminders");
  const has1d = rems1.some(r => r.reminderType === "1d");
  assert.ok(has1d, "Test 1: Assignment should include 1-day reminder");
  console.log("✓ Test 1 passed: Deadline reminder generated for Assignment");

  // ---------------------------------------------------------------------------
  // Test 2: Exam reminder generated with eventDate and eventTime
  // ---------------------------------------------------------------------------
  const item2: AcademicItem = {
    id: "test-exam-1",
    title: "DBMS Midterm Exam",
    subject: "DBMS",
    type: "EXAM",
    status: "INBOX",
    eventDate: "2026-10-05",
    eventTime: "10:00 AM",
    resourceUrls: [],
    attachmentNames: [],
    description: "Units 1 to 3",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const rems2 = calculateApplicableReminders(item2, DEFAULT_REMINDER_SETTINGS, baseDate);
  assert.ok(rems2.length > 0, "Test 2: Exam should generate reminders");
  assert.ok(rems2.some(r => r.reminderType === "7d"), "Test 2: 7-day reminder should be generated for exam 9 days out");
  console.log("✓ Test 2 passed: Exam reminder generated with eventDate and eventTime");

  // ---------------------------------------------------------------------------
  // Test 3: 7-day reminder generated for distant event (10 days out)
  // ---------------------------------------------------------------------------
  const item3: AcademicItem = {
    id: "test-distant-1",
    title: "Final Project Submission",
    subject: "FoDS",
    type: "PROJECT",
    status: "NOT_STARTED",
    deadline: "2026-10-06T23:59:00+05:30", // 10 days after Sep 26
    resourceUrls: [],
    attachmentNames: [],
    description: "Capstone",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const rems3 = calculateApplicableReminders(item3, DEFAULT_REMINDER_SETTINGS, baseDate);
  const rem7d = rems3.find(r => r.reminderType === "7d");
  assert.ok(rem7d, "Test 3: 7d reminder must be generated");
  assert.strictEqual(new Date(rem7d.scheduledFor).getDate(), 29, "Test 3: 7d reminder must be scheduled on Sep 29");
  console.log("✓ Test 3 passed: 7-day reminder generated");

  // ---------------------------------------------------------------------------
  // Test 4: 3-day reminder generated for 4 days out
  // ---------------------------------------------------------------------------
  const item4: AcademicItem = {
    id: "test-3d-1",
    title: "Slip Test 2",
    subject: "NLP",
    type: "SLIP_TEST",
    status: "INBOX",
    eventDate: "2026-09-30",
    eventTime: "10:00 AM", // 4 days after Sep 26
    resourceUrls: [],
    attachmentNames: [],
    description: "NLP Unit 2",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const rems4 = calculateApplicableReminders(item4, DEFAULT_REMINDER_SETTINGS, baseDate);
  const rem3d = rems4.find(r => r.reminderType === "3d");
  assert.ok(rem3d, "Test 4: 3-day reminder must be generated");
  console.log("✓ Test 4 passed: 3-day reminder generated");

  // ---------------------------------------------------------------------------
  // Test 5: 1-day reminder generated for event due tomorrow
  // ---------------------------------------------------------------------------
  const item5: AcademicItem = {
    id: "test-tomorrow-1",
    title: "Computer Networks Quiz",
    subject: "CN",
    type: "QUIZ",
    status: "NOT_STARTED",
    eventDate: "2026-09-27",
    eventTime: "2:00 PM", // tomorrow from Sep 26
    resourceUrls: [],
    attachmentNames: [],
    description: "Subnetting Quiz",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const rems5 = calculateApplicableReminders(item5, DEFAULT_REMINDER_SETTINGS, baseDate);
  const rem1d = rems5.find(r => r.reminderType === "1d");
  assert.ok(rem1d, "Test 5: 1-day reminder must be generated");
  console.log("✓ Test 5 passed: 1-day reminder generated");

  // ---------------------------------------------------------------------------
  // Test 6: 3-hour reminder generated for event due today in 5 hours
  // ---------------------------------------------------------------------------
  const item6: AcademicItem = {
    id: "test-3h-1",
    title: "NLP Lab Exercise",
    subject: "NLP",
    type: "LAB",
    status: "IN_PROGRESS",
    deadline: "2026-09-26T15:00:00+05:30", // 5 hours ahead of 10:00
    resourceUrls: [],
    attachmentNames: [],
    description: "Lab Practice",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const rems6 = calculateApplicableReminders(item6, DEFAULT_REMINDER_SETTINGS, baseDate);
  const rem3h = rems6.find(r => r.reminderType === "3h");
  assert.ok(rem3h, "Test 6: 3-hour reminder must be generated");
  console.log("✓ Test 6 passed: 3-hour reminder generated");

  // ---------------------------------------------------------------------------
  // Test 7: 1-hour reminder generated for event due today in 2 hours
  // ---------------------------------------------------------------------------
  const item7: AcademicItem = {
    id: "test-1h-1",
    title: "Urgent Lab Submission",
    subject: "NLP",
    type: "LAB",
    status: "IN_PROGRESS",
    deadline: "2026-09-26T12:00:00+05:30", // 2 hours ahead of 10:00
    resourceUrls: [],
    attachmentNames: [],
    description: "Upload code",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const rems7 = calculateApplicableReminders(item7, DEFAULT_REMINDER_SETTINGS, baseDate);
  const rem1h = rems7.find(r => r.reminderType === "1h");
  assert.ok(rem1h, "Test 7: 1-hour reminder must be generated");
  console.log("✓ Test 7 passed: 1-hour reminder generated");

  // ---------------------------------------------------------------------------
  // Test 8: Too-close events skip irrelevant reminder intervals
  // ---------------------------------------------------------------------------
  // Item 5 is tomorrow: it should NOT have 7d or 3d reminders
  assert.strictEqual(rems5.some(r => r.reminderType === "7d"), false, "Test 8: 7d reminder must be skipped for tomorrow");
  assert.strictEqual(rems5.some(r => r.reminderType === "3d"), false, "Test 8: 3d reminder must be skipped for tomorrow");
  console.log("✓ Test 8 passed: Too-close events skip irrelevant reminder intervals");

  // ---------------------------------------------------------------------------
  // Test 9: Cancelled event generates no reminder
  // ---------------------------------------------------------------------------
  const itemCancelled: AcademicItem = {
    ...item1,
    id: "test-cancelled-1",
    status: "CANCELLED"
  };
  const remsCancelled = calculateApplicableReminders(itemCancelled, DEFAULT_REMINDER_SETTINGS, baseDate);
  assert.strictEqual(remsCancelled.length, 0, "Test 9: Cancelled event should have 0 reminders");
  console.log("✓ Test 9 passed: Cancelled event generates no reminder");

  // ---------------------------------------------------------------------------
  // Test 10: Completed event generates no reminder
  // ---------------------------------------------------------------------------
  const itemCompleted: AcademicItem = {
    ...item1,
    id: "test-completed-1",
    status: "COMPLETED"
  };
  const remsCompleted = calculateApplicableReminders(itemCompleted, DEFAULT_REMINDER_SETTINGS, baseDate);
  assert.strictEqual(remsCompleted.length, 0, "Test 10: Completed event should have 0 reminders");
  console.log("✓ Test 10 passed: Completed event generates no reminder");

  // ---------------------------------------------------------------------------
  // Test 11: Duplicate reminder prevented
  // ---------------------------------------------------------------------------
  clearInMemoryReminders();
  await createAcademicEvent(item3);
  const genResult1 = await generateReminders(baseDate, false);
  const countAfterFirst = (await getAllReminders()).length;
  assert.ok(countAfterFirst > 0, "Test 11: Reminders should be created on first run");

  // Run again: no duplicates should be added
  const genResult2 = await generateReminders(baseDate, false);
  assert.strictEqual(genResult2.remindersCreated, 0, "Test 11: Duplicate run must create 0 new reminders");
  const countAfterSecond = (await getAllReminders()).length;
  assert.strictEqual(countAfterSecond, countAfterFirst, "Test 11: Reminder count must remain identical");
  console.log("✓ Test 11 passed: Duplicate reminder prevented");

  // ---------------------------------------------------------------------------
  // Test 12: Postponement invalidates old reminder
  // ---------------------------------------------------------------------------
  // Postpone item3 from Oct 6 to Oct 15
  await updateAcademicEvent(item3.id, {
    deadline: "2026-10-15T23:59:00+05:30",
    status: "POSTPONED"
  });

  const genResultPostpone = await generateReminders(baseDate, false);
  assert.ok(genResultPostpone.remindersCancelled > 0, "Test 12: Old reminders must be marked CANCELLED");
  const cancelledReminders = await getAllReminders({ eventId: item3.id, status: "CANCELLED" });
  assert.ok(cancelledReminders.length > 0, "Test 12: Cancelled reminders must exist for previous version");
  console.log("✓ Test 12 passed: Postponement invalidates old reminder");

  // ---------------------------------------------------------------------------
  // Test 13: New reminder created after postponement
  // ---------------------------------------------------------------------------
  const newActive = await getAllReminders({ eventId: item3.id, status: "SCHEDULED" });
  assert.ok(newActive.length > 0, "Test 13: New reminders must be created for postponed event");
  const new7d = newActive.find(r => r.reminderType === "7d");
  assert.ok(new7d, "Test 13: New 7d reminder exists");
  assert.strictEqual(new Date(new7d.scheduledFor).getDate(), 8, "Test 13: New 7d reminder must be scheduled on Oct 8");
  console.log("✓ Test 13 passed: New reminder created after postponement");

  // ---------------------------------------------------------------------------
  // Test 14: Cancellation cancels future reminders
  // ---------------------------------------------------------------------------
  await updateAcademicEvent(item3.id, { status: "CANCELLED" });
  await generateReminders(baseDate, false);
  const remainingScheduled = await getAllReminders({ eventId: item3.id, status: "SCHEDULED" });
  assert.strictEqual(remainingScheduled.length, 0, "Test 14: No SCHEDULED reminders should remain for cancelled event");
  console.log("✓ Test 14 passed: Cancellation cancels future reminders");

  // ---------------------------------------------------------------------------
  // Test 15: Needs-confirmation event does not invent deadline
  // ---------------------------------------------------------------------------
  const itemAmbiguous: AcademicItem = {
    id: "test-ambiguous-1",
    title: "AI Assignment 1",
    subject: "AI",
    type: "ASSIGNMENT",
    status: "INBOX",
    needsConfirmation: true,
    resourceUrls: [],
    attachmentNames: [],
    description: "Submit soon",
    originalMessages: ["Submit soon"],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  const remsAmbiguous = calculateApplicableReminders(itemAmbiguous, DEFAULT_REMINDER_SETTINGS, baseDate);
  assert.ok(remsAmbiguous.length > 0, "Test 15: Needs-confirmation event should have alert");
  assert.ok(remsAmbiguous[0].message.includes("deadline unclear"), "Test 15: Message must state deadline unclear");
  assert.ok(remsAmbiguous[0].message.includes("Please confirm"), "Test 15: Message must ask to confirm deadline");
  console.log("✓ Test 15 passed: Needs-confirmation event does not invent deadline");

  // ---------------------------------------------------------------------------
  // Test 16: Overdue event detected
  // ---------------------------------------------------------------------------
  const itemPast: AcademicItem = {
    id: "test-overdue-1",
    title: "Data Science Assignment 1",
    subject: "FoDS",
    type: "ASSIGNMENT",
    status: "NOT_STARTED",
    deadline: "2026-09-24T23:59:00+05:30", // 2 days ago relative to Sep 26
    resourceUrls: [],
    attachmentNames: [],
    description: "Old assignment",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };

  assert.strictEqual(isEventOverdue(itemPast, baseDate), true, "Test 16: isEventOverdue should be true");
  const remsOverdue = calculateApplicableReminders(itemPast, DEFAULT_REMINDER_SETTINGS, baseDate);
  assert.ok(remsOverdue.some(r => r.reminderType === "OVERDUE"), "Test 16: Overdue reminder must be created");
  console.log("✓ Test 16 passed: Overdue event detected");

  // ---------------------------------------------------------------------------
  // Test 17: Overdue notification not spammed
  // ---------------------------------------------------------------------------
  clearInMemoryReminders();
  await createAcademicEvent(itemPast);
  await generateReminders(baseDate, false);
  const overdueReminders1 = await getAllReminders({ eventId: itemPast.id, status: "SCHEDULED" });
  assert.strictEqual(overdueReminders1.length, 1, "Test 17: Exactly one overdue reminder scheduled");

  // Triggering again on the same day should NOT add a second overdue reminder
  await generateReminders(baseDate, false);
  const overdueReminders2 = await getAllReminders({ eventId: itemPast.id, status: "SCHEDULED" });
  assert.strictEqual(overdueReminders2.length, 1, "Test 17: Overdue reminder must not be duplicated on same day");
  console.log("✓ Test 17 passed: Overdue notification not spammed");

  // ---------------------------------------------------------------------------
  // Test 18-24: Morning Briefing Tests
  // ---------------------------------------------------------------------------
  clearInMemoryReminders();

  // Create set of test events:
  // Today's event (due at 15:00 on Sep 26)
  const itemToday: AcademicItem = {
    id: "briefing-today-1",
    title: "DBMS Assignment 3",
    subject: "DBMS",
    type: "ASSIGNMENT",
    status: "IN_PROGRESS",
    deadline: "2026-09-26T23:59:00+05:30",
    resourceUrls: [],
    attachmentNames: [],
    description: "Due today",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemToday);

  // Tomorrow's event (Sep 27)
  const itemTomorrow: AcademicItem = {
    id: "briefing-tomorrow-1",
    title: "Computer Networks Quiz",
    subject: "CN",
    type: "QUIZ",
    status: "NOT_STARTED",
    eventDate: "2026-09-27",
    eventTime: "10:00 AM",
    resourceUrls: [],
    attachmentNames: [],
    description: "Quiz tomorrow",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemTomorrow);

  // Upcoming Exam (Sep 30 - 4 days away)
  const itemUpcomingExam: AcademicItem = {
    id: "briefing-exam-1",
    title: "OS Slip Test",
    subject: "OS",
    type: "SLIP_TEST",
    status: "INBOX",
    eventDate: "2026-09-30",
    eventTime: "2:00 PM",
    resourceUrls: [],
    attachmentNames: [],
    description: "Slip test next week",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemUpcomingExam);

  // Overdue item
  const itemBriefingOverdue: AcademicItem = {
    id: "briefing-overdue-1",
    title: "NLP Lab 1",
    subject: "NLP",
    type: "LAB",
    status: "NOT_STARTED",
    deadline: "2026-09-23T23:59:00+05:30",
    resourceUrls: [],
    attachmentNames: [],
    description: "Missed lab",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemBriefingOverdue);

  // Needs confirmation item
  const itemBriefingConfirm: AcademicItem = {
    id: "briefing-confirm-1",
    title: "FoDS Project Draft",
    subject: "FoDS",
    type: "PROJECT",
    status: "INBOX",
    needsConfirmation: true,
    resourceUrls: [],
    attachmentNames: [],
    description: "Unclear deadline",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemBriefingConfirm);

  // Cancelled item (must be excluded)
  const itemBriefingCancelled: AcademicItem = {
    id: "briefing-cancelled-1",
    title: "Cancelled Mathematics Quiz",
    subject: "Mathematics",
    type: "QUIZ",
    status: "CANCELLED",
    eventDate: "2026-09-26",
    resourceUrls: [],
    attachmentNames: [],
    description: "Cancelled",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemBriefingCancelled);

  // Completed item (must be excluded)
  const itemBriefingCompleted: AcademicItem = {
    id: "briefing-completed-1",
    title: "Finished OS Lab",
    subject: "OS",
    type: "LAB",
    status: "COMPLETED",
    deadline: "2026-09-26T12:00:00+05:30",
    resourceUrls: [],
    attachmentNames: [],
    description: "Done",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemBriefingCompleted);

  // Generate briefing
  const briefing = await generateMorningBriefing(baseDate, "Asia/Kolkata");

  // Test 18: Today's events
  assert.ok(briefing.today.some(it => it.id === itemToday.id), "Test 18: Briefing must include today's event");
  console.log("✓ Test 18 passed: Morning briefing includes today's events");

  // Test 19: Tomorrow's events
  assert.ok(briefing.tomorrow.some(it => it.id === itemTomorrow.id), "Test 19: Briefing must include tomorrow's event");
  console.log("✓ Test 19 passed: Morning briefing includes tomorrow's events");

  // Test 20: Upcoming exams/tests
  assert.ok(briefing.upcoming.some(it => it.id === itemUpcomingExam.id), "Test 20: Briefing must include upcoming exam");
  console.log("✓ Test 20 passed: Morning briefing includes upcoming exams");

  // Test 21: Needs confirmation events
  assert.ok(briefing.needsConfirmation.some(it => it.id === itemBriefingConfirm.id), "Test 21: Briefing must include needs-confirmation event");
  console.log("✓ Test 21 passed: Morning briefing includes needs-confirmation events");

  // Test 22: Overdue events
  assert.ok(briefing.overdue.some(it => it.id === itemBriefingOverdue.id), "Test 22: Briefing must include overdue event");
  console.log("✓ Test 22 passed: Morning briefing includes overdue events");

  // Test 23: Completed events excluded
  const allBriefingItems = [...briefing.today, ...briefing.tomorrow, ...briefing.upcoming, ...briefing.overdue];
  assert.strictEqual(allBriefingItems.some(it => it.id === itemBriefingCompleted.id), false, "Test 23: Completed items must be excluded");
  console.log("✓ Test 23 passed: Completed events excluded from morning briefing");

  // Test 24: Cancelled events excluded
  assert.strictEqual(allBriefingItems.some(it => it.id === itemBriefingCancelled.id), false, "Test 24: Cancelled items must be excluded");
  console.log("✓ Test 24 passed: Cancelled events excluded from morning briefing");

  // ---------------------------------------------------------------------------
  // Test 25: Timezone calculations use Asia/Kolkata
  // ---------------------------------------------------------------------------
  const dateTarget = getEventTargetDate({
    ...item2,
    eventDate: "2026-10-05",
    eventTime: "10:00 AM"
  });
  assert.ok(dateTarget, "Test 25: Target date must be parsed");
  // 10:00 AM IST (+05:30) is 04:30 AM UTC
  assert.strictEqual(dateTarget.getUTCHours(), 4, "Test 25: 10:00 AM IST must be 04:30 UTC");
  assert.strictEqual(dateTarget.getUTCMinutes(), 30, "Test 25: 10:00 AM IST must be 04:30 UTC");
  console.log("✓ Test 25 passed: Timezone calculations use Asia/Kolkata");

  // ---------------------------------------------------------------------------
  // Test 26: Submission URL preserved
  // ---------------------------------------------------------------------------
  const itemWithUrl: AcademicItem = {
    ...item1,
    id: "test-url-1",
    submissionUrl: "https://forms.gle/special-submission"
  };
  const msgWithUrl = formatReminderMessage(itemWithUrl, "1d", 24 * 3600 * 1000);
  assert.ok(msgWithUrl.includes("Open Submission"), "Test 26: Message must include 'Open Submission'");
  assert.ok(msgWithUrl.includes("https://forms.gle/special-submission"), "Test 26: Message must include submissionUrl");
  console.log("✓ Test 26 passed: Submission URL preserved in reminder message");

  // ---------------------------------------------------------------------------
  // Test 27: Notification provider abstraction works
  // ---------------------------------------------------------------------------
  mockProvider.clear();
  // Generate and dispatch reminders for itemToday (due today at 23:59)
  // Let's create an item due in 10 minutes from baseDate to test dispatch
  const itemDueNow: AcademicItem = {
    id: "item-due-now-1",
    title: "Final Flash Quiz",
    subject: "AI",
    type: "QUIZ",
    status: "INBOX",
    deadline: new Date(baseDate.getTime() + 5 * 60 * 1000).toISOString(),
    resourceUrls: [],
    attachmentNames: [],
    description: "Now",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(itemDueNow);
  const genDispatchResult = await generateReminders(baseDate, true);
  assert.ok(genDispatchResult.remindersCreated > 0, "Test 27: Reminders should be created");
  console.log("✓ Test 27 passed: Notification provider abstraction works");

  // ---------------------------------------------------------------------------
  // Test 28: Browser notification unavailable does not crash
  // ---------------------------------------------------------------------------
  const browserProvider = new BrowserNotificationProvider();
  assert.strictEqual(browserProvider.isAvailable(), false, "Test 28: isAvailable should be false in node/SSR");
  const browserResult = await browserProvider.send({
    id: "test-browser-1",
    title: "Test",
    body: "Test Body",
    channel: "BROWSER",
    priority: "NORMAL",
    scheduledFor: new Date().toISOString()
  });
  assert.strictEqual(browserResult.success, false, "Test 28: Safely returns false without throwing");
  assert.ok(browserResult.error, "Test 28: Returns informative error message");
  console.log("✓ Test 28 passed: Browser notification unavailable does not crash");

  // ---------------------------------------------------------------------------
  // Test 29: Reminder settings update correctly
  // ---------------------------------------------------------------------------
  const initialSettings = await getReminderSettings();
  assert.strictEqual(initialSettings.morning_briefing_time, "07:30", "Test 29: Default briefing time is 07:30");

  const updatedSettings = await updateReminderSettings({
    morning_briefing_time: "08:00",
    default_reminder_intervals: ["3d", "1d", "1h"]
  });
  assert.strictEqual(updatedSettings.morning_briefing_time, "08:00", "Test 29: Briefing time should update to 08:00");
  assert.deepStrictEqual(updatedSettings.default_reminder_intervals, ["3d", "1d", "1h"], "Test 29: Intervals updated");
  console.log("✓ Test 29 passed: Reminder settings update correctly");

  // ---------------------------------------------------------------------------
  // Test 30: Event update regenerates reminder schedule
  // ---------------------------------------------------------------------------
  // Revert settings to default
  await updateReminderSettings({
    morning_briefing_time: "07:30",
    default_reminder_intervals: ["7d", "3d", "1d", "3h", "1h"]
  });

  const eventToUpdate: AcademicItem = {
    id: "event-update-schedule-1",
    title: "NLP Assignment 4",
    subject: "NLP",
    type: "ASSIGNMENT",
    status: "IN_PROGRESS",
    deadline: "2026-10-02T23:59:00+05:30",
    resourceUrls: [],
    attachmentNames: [],
    description: "Transformers",
    originalMessages: [],
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(eventToUpdate);
  await generateReminders(baseDate, false);

  const initialSchedule = await getAllReminders({ eventId: eventToUpdate.id, status: "SCHEDULED" });
  assert.ok(initialSchedule.length > 0, "Test 30: Initial schedule created");

  // Extend deadline to Oct 10
  await updateAcademicEvent(eventToUpdate.id, {
    deadline: "2026-10-10T23:59:00+05:30"
  });

  await generateReminders(baseDate, false);
  const updatedSchedule = await getAllReminders({ eventId: eventToUpdate.id, status: "SCHEDULED" });
  const cancelledPast = await getAllReminders({ eventId: eventToUpdate.id, status: "CANCELLED" });

  assert.ok(cancelledPast.length > 0, "Test 30: Previous reminders must be marked CANCELLED");
  assert.ok(updatedSchedule.length > 0, "Test 30: New schedule must be created for new deadline");
  assert.strictEqual(updatedSchedule[0].eventVersion, 2, "Test 30: New reminders belong to eventVersion 2");
  console.log("✓ Test 30 passed: Event update regenerates reminder schedule");

  console.log("\n============================================================");
  console.log("ALL 30 PHASE 4B REMINDER & BRIEFING TESTS PASSED CLEANLY! 🎉");
  console.log("============================================================\n");
}

runTests().catch(err => {
  console.error("❌ Test suite failed with error:", err);
  process.exit(1);
});
