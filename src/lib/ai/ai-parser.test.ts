import assert from "node:assert";
import {
  AIExtractionOutput,
  AIParseContext,
  AIProvider,
  CONFIDENCE_THRESHOLDS,
  evaluateConfidence,
  validateAndSanitizeAIExtraction
} from "./index";
import { processAcademicMessageWithAI } from "../events";
import { AcademicItem } from "../types";

console.log("=== RUNNING PHASE 2 AI PARSER & FIXTURE TEST SUITE ===");

// ---------------------------------------------------------------------------
// 1. UNIT TESTS: Schema Validation & Confidence Evaluation
// ---------------------------------------------------------------------------
console.log("\n--- Section 1: Schema Validation & Confidence Unit Tests ---");

// Test valid output
const validRaw = {
  action: "CREATED",
  type: "LAB",
  title: "Lab 2 practice question",
  subject: "NLP",
  eventDate: "2026-09-25",
  eventTime: "11:35 AM",
  deadline: "2026-09-25T11:35:00",
  deadlineTime: "11:35 AM",
  submissionUrl: "https://classroom.google.com",
  resourceUrls: ["https://example.com/reference"],
  attachmentNames: ["lab2.ipynb"],
  description: "Complete and upload document.",
  requirements: ["Run all cells", "Submit PDF"],
  changeDescription: null,
  targetEventTitle: null,
  confidence: 0.95,
  needsConfirmation: false,
  confirmationReason: null
};

const validated = validateAndSanitizeAIExtraction(validRaw);
assert.strictEqual(validated.success, true, "Schema should successfully validate clean input");
assert.strictEqual(validated.data.title, "Lab 2 practice question");
assert.strictEqual(validated.data.submissionUrl, "https://classroom.google.com");
assert.strictEqual(validated.data.resourceUrls.length, 1);
console.log("✓ Unit Test 1: Clean schema validation passes");

// Test invalid URL and excessive length sanitization
const uncleanedRaw = {
  action: "INVALID_ACTION_NAME",
  type: "LAB",
  submissionUrl: "not-a-valid-url",
  resourceUrls: ["http://valid.com", "not-a-url"],
  confidence: 1.5 // out of bounds
};

const sanitized = validateAndSanitizeAIExtraction(uncleanedRaw);
// Invalid action should be caught and returned safely
assert.strictEqual(sanitized.data.needsConfirmation, true, "Invalid action triggers safe fallback");
console.log("✓ Unit Test 2: Malformed AI payload safely sanitized to fallback");

// Test confidence evaluation rules
assert.strictEqual(evaluateConfidence(0.95, false), "HIGH", ">= 0.90 is HIGH");
assert.strictEqual(evaluateConfidence(0.85, false), "MEDIUM", "0.70-0.89 is MEDIUM");
assert.strictEqual(evaluateConfidence(0.65, false), "NEEDS_CONFIRMATION", "< 0.70 is NEEDS_CONFIRMATION");
assert.strictEqual(evaluateConfidence(0.95, true), "NEEDS_CONFIRMATION", "Explicit needsConfirmation flag forces confirmation");
console.log("✓ Unit Test 3: Confidence threshold logic (0.90 / 0.70) verified");

// ---------------------------------------------------------------------------
// 2. MOCK GEMINI PROVIDER FOR THE 22 FIXTURE CASES
// ---------------------------------------------------------------------------
class MockGeminiProvider implements AIProvider {
  name = "mock-gemini";

  isAvailable(): boolean {
    return true;
  }

  async extract(message: string, context: AIParseContext): Promise<AIExtractionOutput> {
    const text = message.trim();

    // 16. Non-academic chatter
    if (/^good\s+morning\s+sir/i.test(text) || /^happy\s+birthday/i.test(text)) {
      return {
        action: "NON_ACADEMIC",
        type: "OTHER",
        title: null,
        subject: null,
        eventDate: null,
        eventTime: null,
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.99,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 17. Missing deadline / ambiguous
    if (/submit this soon/i.test(text)) {
      return {
        action: "CREATED",
        type: "ASSIGNMENT",
        title: "Assignment Submission",
        subject: null,
        eventDate: null,
        eventTime: null,
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.5,
        needsConfirmation: true,
        confirmationReason: "Deadline is not specified."
      };
    }

    // 11. Postponement
    if (/postponed to 3 october/i.test(text)) {
      return {
        action: "POSTPONED",
        type: "SLIP_TEST",
        title: "Slip Test 2",
        subject: "NLP",
        eventDate: "2026-10-03",
        eventTime: "First hour",
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: "Event date changed from 2026-09-30 to 2026-10-03",
        targetEventTitle: "Slip Test 2",
        confidence: 0.98,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 12. Cancellation
    if (/slip test 2 is cancelled/i.test(text)) {
      return {
        action: "CANCELLED",
        type: "SLIP_TEST",
        title: "Slip Test 2",
        subject: "NLP",
        eventDate: null,
        eventTime: null,
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: "Slip Test 2 cancelled due to heavy rain.",
        targetEventTitle: "Slip Test 2",
        confidence: 0.95,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 13. Deadline extension
    if (/deadline for assignment 1 extended till 05-10-2026/i.test(text)) {
      return {
        action: "UPDATED",
        type: "ASSIGNMENT",
        title: "Assignment 1",
        subject: "OS",
        eventDate: null,
        eventTime: null,
        deadline: "2026-10-05T23:59:00",
        deadlineTime: "11:59 PM",
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: "Deadline extended to 2026-10-05T23:59:00",
        targetEventTitle: "Assignment 1",
        confidence: 0.96,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 14. Submission link replacement
    if (/new submission link for lab 2:/i.test(text)) {
      return {
        action: "UPDATED",
        type: "LAB",
        title: "Lab 2 practice question",
        subject: "NLP",
        eventDate: null,
        eventTime: null,
        deadline: null,
        deadlineTime: null,
        submissionUrl: "https://forms.gle/newlink",
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: "Submission link updated: https://forms.gle/newlink",
        targetEventTitle: "Lab 2 practice question",
        confidence: 0.97,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 18. Relative date "tomorrow"
    if (/submit lab report tomorrow by 5 pm/i.test(text)) {
      const tomorrow = new Date(context.currentDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      return {
        action: "CREATED",
        type: "LAB",
        title: "Lab Report Submission",
        subject: context.sourceGroup ?? null,
        eventDate: tomorrowStr,
        eventTime: "5:00 PM",
        deadline: `${tomorrowStr}T17:00:00`,
        deadlineTime: "5:00 PM",
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.92,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 19. Relative date "Monday"
    if (/quiz will be held on monday at 10 am/i.test(text)) {
      // Reference date is 2026-09-25 (Friday), next Monday is 2026-09-28
      return {
        action: "CREATED",
        type: "QUIZ",
        title: "Quiz 1",
        subject: "Maths",
        eventDate: "2026-09-28",
        eventTime: "10:00 AM",
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.94,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 20. Multiple links
    if (/refer to https:\/\/github.com\/repo/i.test(text)) {
      return {
        action: "CREATED",
        type: "ASSIGNMENT",
        title: "Project Milestone 1",
        subject: "Web Tech",
        eventDate: null,
        eventTime: null,
        deadline: "2026-10-01T23:59:00",
        deadlineTime: "11:59 PM",
        submissionUrl: "https://forms.gle/submit",
        resourceUrls: ["https://github.com/repo"],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.95,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 21. Multi-line faculty announcement
    if (/important schedule update for internal assessments/i.test(text)) {
      return {
        action: "CREATED",
        type: "EXAM",
        title: "Internal Assessment 1",
        subject: "OS",
        eventDate: "2026-10-12",
        eventTime: "9:30 AM",
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: ["https://college.edu/syllabus"],
        attachmentNames: ["syllabus.pdf"],
        description: "Covers Units 1 and 2. Bring scientific calculators.",
        requirements: ["Bring hall ticket", "Scientific calculator allowed"],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.96,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 22. Irrelevant chatter plus real assignment
    if (/hope you had a good weekend/i.test(text)) {
      return {
        action: "CREATED",
        type: "ASSIGNMENT",
        title: "Assignment 2",
        subject: context.sourceGroup ?? null,
        eventDate: context.currentDate,
        eventTime: "5:00 PM",
        deadline: `${context.currentDate}T17:00:00`,
        deadlineTime: "5:00 PM",
        submissionUrl: "https://submit.com",
        resourceUrls: [],
        attachmentNames: [],
        description: "Submit assignment 2 before 5 pm today.",
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.93,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 1. Assignment + deadline
    if (/submit assignment 3 on or before 15-10-2026/i.test(text)) {
      return {
        action: "CREATED",
        type: "ASSIGNMENT",
        title: "Assignment 3",
        subject: "DBMS",
        eventDate: null,
        eventTime: null,
        deadline: "2026-10-15T23:59:00",
        deadlineTime: "11:59 PM",
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.95,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 2. Assignment + submission link
    if (/upload assignment 1 here:\s*https:\/\/forms.gle\/abc/i.test(text)) {
      return {
        action: "CREATED",
        type: "ASSIGNMENT",
        title: "Assignment 1",
        subject: context.sourceGroup ?? null,
        eventDate: null,
        eventTime: null,
        deadline: null,
        deadlineTime: null,
        submissionUrl: "https://forms.gle/abc",
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.92,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 3. Exam announcement
    if (/end semester examination scheduled on 20-11-2026/i.test(text)) {
      return {
        action: "CREATED",
        type: "EXAM",
        title: "End Semester Examination",
        subject: "AI",
        eventDate: "2026-11-20",
        eventTime: "10:00 AM",
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.96,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 4. Slip test
    if (/slip test 2 will be conducted on 30-09-2026 during the first hour/i.test(text)) {
      return {
        action: "CREATED",
        type: "SLIP_TEST",
        title: "Slip Test 2",
        subject: "NLP",
        eventDate: "2026-09-30",
        eventTime: "First hour",
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.97,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 5. Quiz
    if (/online quiz 1 will be held tomorrow at 4:00 pm/i.test(text)) {
      return {
        action: "CREATED",
        type: "QUIZ",
        title: "Online Quiz 1",
        subject: "CN",
        eventDate: "2026-09-26",
        eventTime: "4:00 PM",
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.93,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 6. Lab assignment
    if (/practice the lab2 practice question and upload the document before 11:35 am/i.test(text)) {
      return {
        action: "CREATED",
        type: "LAB",
        title: "Lab 2 practice question",
        subject: context.sourceGroup ?? null,
        eventDate: context.currentDate,
        eventTime: "11:35 AM",
        deadline: `${context.currentDate}T11:35:00`,
        deadlineTime: "11:35 AM",
        submissionUrl: "https://example.com",
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.94,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 7. Project
    if (/submit mini project abstract by friday/i.test(text)) {
      return {
        action: "CREATED",
        type: "PROJECT",
        title: "Mini Project Abstract",
        subject: "Software Engineering",
        eventDate: "2026-09-25",
        eventTime: "5:00 PM",
        deadline: "2026-09-25T17:00:00",
        deadlineTime: "5:00 PM",
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: ["Max 2 pages", "Problem statement included"],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.91,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 8. Presentation
    if (/seminar presentation scheduled on 10-10-2026/i.test(text)) {
      return {
        action: "CREATED",
        type: "PRESENTATION",
        title: "Seminar Presentation",
        subject: "Cloud Computing",
        eventDate: "2026-10-10",
        eventTime: "2:00 PM",
        deadline: null,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: ["10-12 slides", "Q&A 5 minutes"],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.93,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 9. Course / certification
    if (/complete the coursera aws certification before next month/i.test(text)) {
      return {
        action: "CREATED",
        type: "COURSE",
        title: "Coursera AWS Certification",
        subject: "Cloud",
        eventDate: null,
        eventTime: null,
        deadline: "2026-10-31T23:59:00",
        deadlineTime: "11:59 PM",
        submissionUrl: null,
        resourceUrls: ["https://coursera.org/learn/aws-fundamentals"],
        attachmentNames: [],
        description: text,
        requirements: ["Pass with 80% minimum"],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.92,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // 10. Announcement
    if (/today is the last date to collect the answer sheets/i.test(text)) {
      return {
        action: "CREATED",
        type: "ANNOUNCEMENT",
        title: "Collect Answer Sheets",
        subject: null,
        eventDate: context.currentDate,
        eventTime: null,
        deadline: `${context.currentDate}T23:59:59`,
        deadlineTime: null,
        submissionUrl: null,
        resourceUrls: [],
        attachmentNames: [],
        description: text,
        requirements: [],
        changeDescription: null,
        targetEventTitle: null,
        confidence: 0.96,
        needsConfirmation: false,
        confirmationReason: null
      };
    }

    // Default fallback
    return {
      action: "CREATED",
      type: "OTHER",
      title: "Academic Notice",
      subject: null,
      eventDate: null,
      eventTime: null,
      deadline: null,
      deadlineTime: null,
      submissionUrl: null,
      resourceUrls: [],
      attachmentNames: [],
      description: text,
      requirements: [],
      changeDescription: null,
      targetEventTitle: null,
      confidence: 0.75,
      needsConfirmation: true,
      confirmationReason: "Needs review."
    };
  }
}

// ---------------------------------------------------------------------------
// 3. INTEGRATION TESTS: AI PARSER → EVENT ENGINE (22 TEST FIXTURES)
// ---------------------------------------------------------------------------
console.log("\n--- Section 2: 22 Comprehensive AI Parser & Event Engine Fixtures ---");

async function runFixtures() {
  const mockProvider = new MockGeminiProvider();
  const refDate = new Date("2026-09-25T10:00:00+05:30");
  const options = { referenceDate: refDate, sourceGroup: "NLP Lab", timezone: "Asia/Kolkata" };

  // Track existing items across test cases
  let existingItems: AcademicItem[] = [];

  // Case 1: Assignment + deadline
  const res1 = await processAcademicMessageWithAI(
    "Submit Assignment 3 on or before 15-10-2026 23:59",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res1.action, "CREATED");
  assert.strictEqual(res1.item?.type, "ASSIGNMENT");
  assert.ok(res1.item?.deadline?.includes("2026-10-15"));
  existingItems.push(res1.item!);
  console.log("✓ Case 1 passed: Assignment + deadline");

  // Case 2: Assignment + submission link
  const res2 = await processAcademicMessageWithAI(
    "Upload assignment 1 here: https://forms.gle/abc",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res2.action, "CREATED");
  assert.strictEqual(res2.item?.submissionUrl, "https://forms.gle/abc");
  existingItems.push(res2.item!);
  console.log("✓ Case 2 passed: Assignment + submission link");

  // Case 3: Exam announcement
  const res3 = await processAcademicMessageWithAI(
    "End semester examination scheduled on 20-11-2026",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res3.action, "CREATED");
  assert.strictEqual(res3.item?.type, "EXAM");
  assert.strictEqual(res3.item?.eventDate, "2026-11-20");
  existingItems.push(res3.item!);
  console.log("✓ Case 3 passed: Exam announcement");

  // Case 4: Slip test
  const res4 = await processAcademicMessageWithAI(
    "Slip test 2 will be conducted on 30-09-2026 during the first hour.",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res4.action, "CREATED");
  assert.strictEqual(res4.item?.type, "SLIP_TEST");
  assert.strictEqual(res4.item?.eventDate, "2026-09-30");
  assert.strictEqual(res4.item?.eventTime, "First hour");
  existingItems.push(res4.item!);
  console.log("✓ Case 4 passed: Slip test with specific date & time");

  // Case 5: Quiz
  const res5 = await processAcademicMessageWithAI(
    "Online Quiz 1 will be held tomorrow at 4:00 PM",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res5.action, "CREATED");
  assert.strictEqual(res5.item?.type, "QUIZ");
  assert.strictEqual(res5.item?.eventDate, "2026-09-26");
  existingItems.push(res5.item!);
  console.log("✓ Case 5 passed: Quiz scheduled with time");

  // Case 6: Lab assignment
  const res6 = await processAcademicMessageWithAI(
    "Students can practice the lab2 practice question and upload the document before 11:35 am. Submit here: https://example.com",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res6.action, "CREATED");
  assert.strictEqual(res6.item?.type, "LAB");
  assert.ok(res6.item?.deadline?.includes("11:35"));
  assert.strictEqual(res6.item?.submissionUrl, "https://example.com");
  existingItems.push(res6.item!);
  console.log("✓ Case 6 passed: Lab assignment with deadline and portal link");

  // Case 7: Project
  const res7 = await processAcademicMessageWithAI(
    "Submit mini project abstract by Friday",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res7.action, "CREATED");
  assert.strictEqual(res7.item?.type, "PROJECT");
  existingItems.push(res7.item!);
  console.log("✓ Case 7 passed: Project milestone");

  // Case 8: Presentation
  const res8 = await processAcademicMessageWithAI(
    "Seminar presentation scheduled on 10-10-2026",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res8.action, "CREATED");
  assert.strictEqual(res8.item?.type, "PRESENTATION");
  assert.strictEqual(res8.item?.eventDate, "2026-10-10");
  existingItems.push(res8.item!);
  console.log("✓ Case 8 passed: Presentation scheduling");

  // Case 9: Course/certification
  const res9 = await processAcademicMessageWithAI(
    "Complete the Coursera AWS certification before next month",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res9.action, "CREATED");
  assert.strictEqual(res9.item?.type, "COURSE");
  existingItems.push(res9.item!);
  console.log("✓ Case 9 passed: Course / certification tracking");

  // Case 10: Announcement
  const res10 = await processAcademicMessageWithAI(
    "Today is the last date to collect the answer sheets.",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res10.action, "CREATED");
  assert.strictEqual(res10.item?.type, "ANNOUNCEMENT");
  assert.strictEqual(res10.item?.eventDate, "2026-09-25");
  existingItems.push(res10.item!);
  console.log("✓ Case 10 passed: Department announcement");

  // Case 11: Postponement (Slip Test 2 postponed)
  const res11 = await processAcademicMessageWithAI(
    "Slip Test 2 is postponed to 3 October.",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res11.action, "UPDATED", "Postponement must update existing item");
  assert.strictEqual(res11.item?.eventDate, "2026-10-03");
  assert.strictEqual(res11.item?.status, "POSTPONED");
  assert.ok(res11.item?.changeHistory.length! > 0, "Change history must record postponement");
  assert.ok(res11.beforeAfter, "Before/after state must be captured");
  assert.strictEqual(res11.beforeAfter?.before.eventDate, "2026-09-30");
  assert.strictEqual(res11.beforeAfter?.after.eventDate, "2026-10-03");
  // update item in existing list
  existingItems = existingItems.map(it => it.id === res11.item?.id ? res11.item! : it);
  console.log("✓ Case 11 passed: Postponement modification with before/after tracking");

  // Case 12: Cancellation
  const res12 = await processAcademicMessageWithAI(
    "Slip Test 2 is cancelled due to heavy rain.",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res12.action, "UPDATED");
  assert.strictEqual(res12.item?.status, "CANCELLED");
  assert.ok(res12.beforeAfter?.before.status !== "CANCELLED");
  assert.strictEqual(res12.beforeAfter?.after.status, "CANCELLED");
  existingItems = existingItems.map(it => it.id === res12.item?.id ? res12.item! : it);
  console.log("✓ Case 12 passed: Event cancellation with status update");

  // Case 13: Deadline extension
  const res13 = await processAcademicMessageWithAI(
    "Deadline for Assignment 1 extended till 05-10-2026 11:59 PM.",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res13.action, "UPDATED");
  assert.ok(res13.item?.deadline?.includes("2026-10-05"));
  existingItems = existingItems.map(it => it.id === res13.item?.id ? res13.item! : it);
  console.log("✓ Case 13 passed: Assignment deadline extension");

  // Case 14: Submission link replacement
  const res14 = await processAcademicMessageWithAI(
    "New submission link for Lab 2: https://forms.gle/newlink",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res14.action, "UPDATED");
  assert.strictEqual(res14.item?.submissionUrl, "https://forms.gle/newlink");
  existingItems = existingItems.map(it => it.id === res14.item?.id ? res14.item! : it);
  console.log("✓ Case 14 passed: Submission link replacement");

  // Case 15: Duplicate message
  const res15 = await processAcademicMessageWithAI(
    "Slip test 2 will be conducted on 30-09-2026 during the first hour.",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res15.action, "IGNORED_DUPLICATE");
  console.log("✓ Case 15 passed: Duplicate message detected & ignored");

  // Case 16: Non-academic chatter
  const res16 = await processAcademicMessageWithAI(
    "Good morning sir 🙏",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res16.action, "NON_ACADEMIC");
  console.log("✓ Case 16 passed: Non-academic greeting filtered");

  // Case 17: Missing deadline / ambiguous ("Submit this soon.")
  const res17 = await processAcademicMessageWithAI(
    "Submit this soon.",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res17.confidence, "NEEDS_CONFIRMATION");
  assert.strictEqual(res17.aiExtraction?.needsConfirmation, true);
  assert.strictEqual(res17.aiExtraction?.confirmationReason, "Deadline is not specified.");
  console.log("✓ Case 17 passed: Ambiguous deadline marked NEEDS_CONFIRMATION");

  // Case 18: Relative date "tomorrow"
  const res18 = await processAcademicMessageWithAI(
    "Submit lab report tomorrow by 5 PM",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res18.action, "CREATED");
  assert.strictEqual(res18.item?.eventDate, "2026-09-26");
  console.log("✓ Case 18 passed: Relative date 'tomorrow' computed accurately");

  // Case 19: Relative date "Monday"
  const res19 = await processAcademicMessageWithAI(
    "Quiz will be held on Monday at 10 AM",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res19.action, "CREATED");
  assert.strictEqual(res19.item?.eventDate, "2026-09-28");
  console.log("✓ Case 19 passed: Relative day of week 'Monday' resolved");

  // Case 20: Multiple links
  const res20 = await processAcademicMessageWithAI(
    "Submit here: https://forms.gle/submit and refer to https://github.com/repo for reference",
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res20.action, "CREATED");
  assert.strictEqual(res20.item?.submissionUrl, "https://forms.gle/submit");
  assert.ok(res20.item?.resourceUrls.includes("https://github.com/repo"));
  console.log("✓ Case 20 passed: Multiple links properly segregated into submission vs resource");

  // Case 21: Multi-line faculty announcement
  const multiline = `Dear students,
Important schedule update for Internal Assessments.
Internal Assessment 1 is scheduled on 12-10-2026 at 9:30 AM for OS.
Syllabus: https://college.edu/syllabus and syllabus.pdf.
Bring hall ticket.`;
  const res21 = await processAcademicMessageWithAI(
    multiline,
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res21.action, "CREATED");
  assert.strictEqual(res21.item?.eventDate, "2026-10-12");
  assert.strictEqual(res21.item?.subject, "OS");
  console.log("✓ Case 21 passed: Complex multi-line faculty announcement parsed");

  // Case 22: Message containing irrelevant chatter plus real assignment
  const chatterPlusTask = "Hello everyone hope you had a good weekend. Also submit assignment 2 before 5 pm today https://submit.com. Thank you.";
  const res22 = await processAcademicMessageWithAI(
    chatterPlusTask,
    existingItems,
    options,
    mockProvider
  );
  assert.strictEqual(res22.action, "CREATED");
  assert.strictEqual(res22.item?.type, "ASSIGNMENT");
  assert.strictEqual(res22.item?.submissionUrl, "https://submit.com");
  console.log("✓ Case 22 passed: Real assignment isolated from greeting/chatter noise");

  console.log("\n=======================================================");
  console.log("ALL 22 AI PARSER & FIXTURE TESTS PASSED CLEANLY! 🎉");
  console.log("=======================================================\n");
}

runFixtures().catch(err => {
  console.error("Test failure:", err);
  process.exit(1);
});
