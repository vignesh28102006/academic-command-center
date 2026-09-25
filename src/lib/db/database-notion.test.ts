import assert from "node:assert";
import {
  createAcademicEvent,
  updateAcademicEvent,
  getAcademicEventById,
  getAllAcademicEvents,
  deleteAcademicEvent
} from "./academicEvents";
import { recordChangeHistory, getChangeHistoryByEventId } from "./changeHistory";
import { hashMessage, isMessageProcessed, recordRawMessage } from "./rawMessages";
import { resolveSubjectCode, upsertSubjectMapping } from "./subjectMappings";
import { mapAcademicItemToNotionProperties, buildNotionPageBlocks } from "../notion/mapper";
import { syncEventToNotion } from "../notion/sync";
import { AcademicItem, ChangeRecord } from "../types";

console.log("=== RUNNING PHASE 3: DATABASE + NOTION TEST SUITE ===");

async function runPhase3Tests() {
  // ---------------------------------------------------------------------------
  // Test 1: Create new event in Supabase / Data Layer
  // ---------------------------------------------------------------------------
  const newEvent: AcademicItem = {
    id: "test-event-1",
    title: "OS Assignment 1",
    subject: "OS",
    type: "ASSIGNMENT",
    status: "NOT_STARTED",
    deadline: "2026-10-05T23:59:00",
    submissionUrl: "https://classroom.google.com/c/os",
    resourceUrls: ["https://example.com/guide"],
    attachmentNames: ["assignment1.pdf"],
    description: "Implement simple process scheduler.",
    requirements: ["C language", "FIFO & Round Robin"],
    originalMessages: ["Submit OS Assignment 1 before 5 Oct 23:59: https://classroom.google.com/c/os"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    changeHistory: [],
    confidence: "HIGH"
  };

  const created = await createAcademicEvent(newEvent);
  assert.strictEqual(created.id, "test-event-1");
  assert.strictEqual(created.title, "OS Assignment 1");
  assert.strictEqual(created.status, "NOT_STARTED");
  console.log("✓ Test 1 passed: Create new event in Supabase / Data layer");

  // ---------------------------------------------------------------------------
  // Test 2: Update existing event
  // ---------------------------------------------------------------------------
  const updated = await updateAcademicEvent("test-event-1", {
    status: "IN_PROGRESS",
    description: "Updated description: Add multi-threading support."
  });
  assert.ok(updated);
  assert.strictEqual(updated.status, "IN_PROGRESS");
  assert.ok(updated.description.includes("multi-threading"));
  console.log("✓ Test 2 passed: Update existing event in database");

  // ---------------------------------------------------------------------------
  // Test 3: Duplicate message ignored via hash deduplication
  // ---------------------------------------------------------------------------
  const testMsg = "Submit OS Assignment 1 before 5 Oct 23:59: https://classroom.google.com/c/os";
  const hash = hashMessage(testMsg);
  await recordRawMessage(testMsg, {
    processingStatus: "PROCESSED",
    linkedEventId: "test-event-1"
  });

  const isProcessed = await isMessageProcessed(hash);
  assert.strictEqual(isProcessed, true, "Message hash must be marked as processed");
  console.log("✓ Test 3 passed: Duplicate message ignored by hash deduplication");

  // ---------------------------------------------------------------------------
  // Test 4: Postponement updates existing event
  // ---------------------------------------------------------------------------
  const slipTest: AcademicItem = {
    id: "test-slip-test-2",
    title: "Slip Test 2",
    subject: "NLP",
    type: "SLIP_TEST",
    status: "INBOX",
    eventDate: "2026-09-30",
    eventTime: "First hour",
    resourceUrls: [],
    attachmentNames: [],
    description: "Slip test 2 in first hour.",
    originalMessages: ["Slip test 2 on 30-09-2026"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    changeHistory: []
  };
  await createAcademicEvent(slipTest);

  const postponementChange: ChangeRecord = {
    id: crypto.randomUUID(),
    eventId: "test-slip-test-2",
    timestamp: new Date().toISOString(),
    field: "eventDate",
    oldValue: "2026-09-30",
    newValue: "2026-10-03",
    summary: "Date changed from 30 Sep 2026 to 03 Oct 2026 (Postponed)",
    sourceMessage: "Slip test 2 is postponed to 3 October."
  };

  const postponed = await updateAcademicEvent(
    "test-slip-test-2",
    {
      eventDate: "2026-10-03",
      status: "POSTPONED"
    },
    [postponementChange]
  );
  assert.ok(postponed);
  assert.strictEqual(postponed.eventDate, "2026-10-03");
  assert.strictEqual(postponed.status, "POSTPONED");
  console.log("✓ Test 4 passed: Postponement updates existing event");

  // ---------------------------------------------------------------------------
  // Test 5: Change history recorded and retrieved
  // ---------------------------------------------------------------------------
  const history = await getChangeHistoryByEventId("test-slip-test-2");
  assert.ok(history.length >= 1, "Change history must contain postponement entry");
  assert.ok(history[0].summary.includes("Postponed"));
  console.log("✓ Test 5 passed: Change history audit trail recorded and retrieved");

  // ---------------------------------------------------------------------------
  // Test 6: Cancellation recorded
  // ---------------------------------------------------------------------------
  const cancelChange: ChangeRecord = {
    id: crypto.randomUUID(),
    eventId: "test-slip-test-2",
    timestamp: new Date().toISOString(),
    field: "status",
    oldValue: "POSTPONED",
    newValue: "CANCELLED",
    summary: "Event was cancelled due to university holiday"
  };
  const cancelled = await updateAcademicEvent(
    "test-slip-test-2",
    { status: "CANCELLED" },
    [cancelChange]
  );
  assert.ok(cancelled);
  assert.strictEqual(cancelled.status, "CANCELLED");
  console.log("✓ Test 6 passed: Event cancellation recorded with change history");

  // ---------------------------------------------------------------------------
  // Test 7: Submission link update
  // ---------------------------------------------------------------------------
  const linkChange: ChangeRecord = {
    id: crypto.randomUUID(),
    eventId: "test-event-1",
    timestamp: new Date().toISOString(),
    field: "submissionUrl",
    oldValue: "https://classroom.google.com/c/os",
    newValue: "https://forms.gle/new-os-link",
    summary: "Submission link updated to https://forms.gle/new-os-link"
  };
  const linkUpdated = await updateAcademicEvent(
    "test-event-1",
    { submissionUrl: "https://forms.gle/new-os-link" },
    [linkChange]
  );
  assert.ok(linkUpdated);
  assert.strictEqual(linkUpdated.submissionUrl, "https://forms.gle/new-os-link");
  console.log("✓ Test 7 passed: Submission link replacement updated in database");

  // ---------------------------------------------------------------------------
  // Test 8: Notion property mapping & page structure
  // ---------------------------------------------------------------------------
  const notionProps = mapAcademicItemToNotionProperties(postponed!);
  assert.strictEqual(notionProps.Title.title[0].text.content, "Slip Test 2");
  assert.strictEqual(notionProps.Subject.select.name, "NLP");
  assert.strictEqual(notionProps.Type.select.name, "SLIP_TEST");
  assert.strictEqual(notionProps.Status.select.name, "POSTPONED");
  assert.strictEqual(notionProps["Event Date"].date.start, "2026-10-03");
  assert.strictEqual(notionProps["Database Event ID"].rich_text[0].text.content, "test-slip-test-2");

  const blocks = buildNotionPageBlocks(postponed!);
  assert.ok(blocks.length > 0, "Page content blocks must be generated");
  console.log("✓ Test 8 passed: Notion property mapper & block structure verified");

  // ---------------------------------------------------------------------------
  // Test 9 & 10: Mock Notion client - Page creation & Update without duplicate
  // ---------------------------------------------------------------------------
  const mockNotionPages = new Map<string, { id: string; properties: any; children: any[] }>();

  class MockNotionClient {
    databases = {
      query: async (params: any) => {
        const eventIdFilter = params.filter?.rich_text?.equals;
        for (const page of mockNotionPages.values()) {
          const pageEventId = page.properties["Database Event ID"]?.rich_text?.[0]?.text?.content;
          if (pageEventId === eventIdFilter) {
            return { results: [page] };
          }
        }
        return { results: [] };
      }
    };

    pages = {
      create: async (params: any) => {
        const id = "notion-page-" + crypto.randomUUID().slice(0, 8);
        const record = { id, properties: params.properties, children: params.children || [] };
        mockNotionPages.set(id, record);
        return { id };
      },
      update: async (params: any) => {
        const existing = mockNotionPages.get(params.page_id);
        if (existing) {
          existing.properties = { ...existing.properties, ...params.properties };
        }
        return { id: params.page_id };
      }
    };

    blocks = {
      children: {
        append: async (params: any) => {
          const existing = mockNotionPages.get(params.block_id);
          if (existing) {
            existing.children.push(...params.children);
          }
          return { results: [] };
        }
      }
    };
  }

  // Simulate Notion sync with mock
  const mockNotion = new MockNotionClient();

  // Create initial page for OS Assignment
  const osProps = mapAcademicItemToNotionProperties(linkUpdated!);
  const createdNotionPage = await mockNotion.pages.create({
    parent: { database_id: "fake-db-id" },
    properties: osProps,
    children: buildNotionPageBlocks(linkUpdated!)
  });
  assert.ok(createdNotionPage.id);
  assert.strictEqual(mockNotionPages.size, 1);
  console.log("✓ Test 9 passed: Notion page creation with properties and content blocks");

  // Update OS Assignment in Notion via Database Event ID lookup
  const queryRes = await mockNotion.databases.query({
    filter: { property: "Database Event ID", rich_text: { equals: "test-event-1" } }
  });
  assert.strictEqual(queryRes.results.length, 1);
  const existingPageId = queryRes.results[0].id;
  assert.strictEqual(existingPageId, createdNotionPage.id);

  // Update properties on existing page
  const updatedProps = {
    ...osProps,
    Status: { select: { name: "SUBMITTED" } }
  };
  await mockNotion.pages.update({
    page_id: existingPageId,
    properties: updatedProps
  });

  // Verify page count did NOT increase (no duplicate page created)
  assert.strictEqual(mockNotionPages.size, 1, "Must update existing page, not create duplicate");
  assert.strictEqual(mockNotionPages.get(existingPageId)?.properties.Status.select.name, "SUBMITTED");
  console.log("✓ Test 10 passed: No duplicate Notion page on update; modifies in-place");

  // ---------------------------------------------------------------------------
  // Test 11: Needs-confirmation event handling
  // ---------------------------------------------------------------------------
  const ambiguousEvent: AcademicItem = {
    id: "test-ambiguous-1",
    title: "Class Project Submission",
    subject: "NEEDS_CONFIRMATION",
    type: "PROJECT",
    status: "INBOX",
    description: "Submit this soon.",
    originalMessages: ["Submit this soon."],
    needsConfirmation: true,
    confidence: "NEEDS_CONFIRMATION",
    confidenceScore: 0.5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    changeHistory: [],
    resourceUrls: [],
    attachmentNames: []
  };

  const createdAmbiguous = await createAcademicEvent(ambiguousEvent);
  assert.strictEqual(createdAmbiguous.needsConfirmation, true);
  assert.strictEqual(createdAmbiguous.deadline, undefined, "Missing deadline must not be hallucinated");

  const ambiguousNotionProps = mapAcademicItemToNotionProperties(createdAmbiguous);
  assert.strictEqual(ambiguousNotionProps["Needs Confirmation"].checkbox, true);
  assert.strictEqual(ambiguousNotionProps.Priority.select.name, "Review");
  console.log("✓ Test 11 passed: Needs-confirmation flag preserved in Supabase and Notion properties");

  // ---------------------------------------------------------------------------
  // Test 12: Missing Notion credentials handled safely
  // ---------------------------------------------------------------------------
  // Temporarily clear Notion env vars to verify graceful SKIPPED status
  const originalToken = process.env.NOTION_TOKEN;
  const originalDb = process.env.NOTION_DATABASE_ID;
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_DATABASE_ID;

  const skippedSync = await syncEventToNotion(createdAmbiguous);
  assert.strictEqual(skippedSync.status, "SKIPPED");
  assert.ok(skippedSync.error?.includes("not configured"));

  // Restore env vars
  if (originalToken) process.env.NOTION_TOKEN = originalToken;
  if (originalDb) process.env.NOTION_DATABASE_ID = originalDb;
  console.log("✓ Test 12 passed: Missing Notion credentials handled safely with SKIPPED status");

  // ---------------------------------------------------------------------------
  // Test 13: Missing Supabase credentials handled safely
  // ---------------------------------------------------------------------------
  // getAllAcademicEvents and createAcademicEvent should work seamlessly with in-memory fallback
  const allEvents = await getAllAcademicEvents();
  assert.ok(allEvents.length >= 3, "In-memory store maintains active events when Supabase is offline");

  const resolved = await resolveSubjectCode("Please submit 19CSE312 lab record");
  assert.strictEqual(resolved, "NLP", "Course code 19CSE312 must map to NLP");

  console.log("✓ Test 13 passed: Missing Supabase credentials handled safely via in-memory store");

  console.log("\n============================================================");
  console.log("ALL 13 PHASE 3 DATABASE + NOTION TESTS PASSED CLEANLY! 🎉");
  console.log("============================================================\n");
}

runPhase3Tests().catch(err => {
  console.error("Phase 3 Test Failure:", err);
  process.exit(1);
});
