import assert from "node:assert";
import { processAcademicMessage } from "./events";
import { AcademicItem } from "./types";

console.log("Running self-check tests for Academic Command Center parser & events engine...");

const referenceDate = new Date("2026-09-25T10:00:00+05:30");

// Test 1: Lab assignment with deadline and submission link
const msg1 = "Students can practice the lab2 practice question and upload the document before 11:35 am. Submit here: https://example.com";
const res1 = processAcademicMessage(msg1, [], { referenceDate });

assert.strictEqual(res1.action, "CREATED", "msg1 should create a new item");
assert.ok(res1.item, "msg1 item should exist");
assert.strictEqual(res1.item.type, "LAB", "msg1 type should be LAB");
assert.ok(res1.item.title.toLowerCase().replace(/\s+/g, "").includes("lab2"), `msg1 title (${res1.item.title}) should mention lab2`);
assert.ok(res1.item.deadline?.includes("11:35"), `msg1 deadline should have 11:35, got ${res1.item.deadline}`);
assert.strictEqual(res1.item.submissionUrl, "https://example.com", "msg1 submissionUrl should match");
assert.strictEqual(res1.item.subject, "NEEDS_CONFIRMATION", "msg1 subject should be NEEDS_CONFIRMATION");
console.log("✓ Test 1 passed: Lab task parsing with deadline and submission link");

// Test 2: Exam / Slip Test with date and time
const msg2 = "Slip test 2 will be conducted on 30-09-2026 during the first hour.";
const res2 = processAcademicMessage(msg2, [], { referenceDate, sourceGroup: "NLP" });

assert.strictEqual(res2.action, "CREATED", "msg2 should create a new item");
assert.ok(res2.item, "msg2 item should exist");
assert.strictEqual(res2.item.type, "SLIP_TEST", "msg2 type should be SLIP_TEST");
assert.strictEqual(res2.item.title, "Slip Test 2", "msg2 title should be Slip Test 2");
assert.strictEqual(res2.item.eventDate, "2026-09-30", `msg2 eventDate should be 2026-09-30, got ${res2.item.eventDate}`);
assert.strictEqual(res2.item.eventTime, "First hour", `msg2 eventTime should be First hour, got ${res2.item.eventTime}`);
assert.strictEqual(res2.item.subject, "NLP", "msg2 subject should be NLP from sourceGroup");
console.log("✓ Test 2 passed: Slip test with specific date and time");

// Test 3: Later message modifying existing event (Slip Test 2 postponed to 3 October)
const existingList: AcademicItem[] = [res2.item!];
const msg3 = "Slip Test 2 is postponed to 3 October.";
const res3 = processAcademicMessage(msg3, existingList, { referenceDate });

assert.strictEqual(res3.action, "UPDATED", "msg3 should update existing item, not create a duplicate");
assert.ok(res3.item, "msg3 updated item should exist");
assert.strictEqual(res3.item.eventDate, "2026-10-03", `eventDate should be 2026-10-03, got ${res3.item.eventDate}`);
assert.strictEqual(res3.item.status, "POSTPONED", "status should be POSTPONED");
assert.strictEqual(res3.item.changeHistory.length, 1, "changeHistory should have 1 entry");
assert.ok(res3.item.changeHistory[0].summary.includes("Postponed"), "changeHistory summary should mention Postponed");
assert.strictEqual(res3.item.originalMessages.length, 2, "originalMessages should contain both messages");
console.log("✓ Test 3 passed: Modification detection and change history tracking for postponement");

// Test 4: Announcement
const msg4 = "Today is the last date to collect the answer sheets.";
const res4 = processAcademicMessage(msg4, [], { referenceDate });

assert.strictEqual(res4.action, "CREATED", "msg4 should create an item");
assert.ok(res4.item, "msg4 item should exist");
assert.strictEqual(res4.item.type, "ANNOUNCEMENT", "msg4 type should be ANNOUNCEMENT");
assert.ok(res4.item.eventDate === "2026-09-25" || res4.item.deadline?.startsWith("2026-09-25"), "msg4 should be dated today");
console.log("✓ Test 4 passed: Announcement detection with today's date");

// Test 5: Non-academic chatter filtering
const msg5 = "Good morning sir";
const res5 = processAcademicMessage(msg5, [], { referenceDate });
assert.strictEqual(res5.action, "NON_ACADEMIC", "msg5 should be filtered as NON_ACADEMIC");
console.log("✓ Test 5 passed: Non-academic greeting filtered");

// Test 6: Duplicate detection
const msg6 = "Slip Test 2 will be conducted on 30-09-2026 during the first hour.";
const res6 = processAcademicMessage(msg6, [res2.item!], { referenceDate });
assert.strictEqual(res6.action, "IGNORED_DUPLICATE", "msg6 should be detected as duplicate");
console.log("✓ Test 6 passed: Duplicate message detected and ignored");

console.log("\nAll 6 self-check tests passed successfully! 🎉");
