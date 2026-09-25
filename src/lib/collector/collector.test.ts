import assert from "node:assert";
import { POST as handleCollectorMessage } from "../../app/api/collector/messages/route";
import { processAcademicMessagePipeline } from "../messages/processor";
import { hashMessage, isMessageProcessed, getRawMessages } from "../db/rawMessages";
import { getAllAcademicEvents, getAcademicEventById } from "../db/academicEvents";
import { getCollectorStats, resetCollectorStats } from "./stats";

console.log("=== RUNNING PHASE 4A: WHATSAPP WEB COLLECTOR TEST SUITE ===");

async function runPhase4ATests() {
  const TEST_SECRET = "test-collector-secret-4a";
  process.env.COLLECTOR_SECRET = TEST_SECRET;
  resetCollectorStats();

  // Helper to create mock Next.js Request
  function makeRequest(body: any, authHeader?: string) {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    if (authHeader !== undefined) {
      headers.set("Authorization", authHeader);
    }
    return new Request("http://localhost:3000/api/collector/messages", {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  }

  // ---------------------------------------------------------------------------
  // Test 1: Missing Authorization Header (401 Unauthorized)
  // ---------------------------------------------------------------------------
  const req1 = makeRequest({
    message: "OS Assignment 1 due tomorrow",
    sourceGroup: "19CSE312 NLP"
  });
  const res1 = await handleCollectorMessage(req1);
  assert.strictEqual(res1.status, 401, "Missing Authorization header must return HTTP 401");
  const data1 = await res1.json();
  assert.ok(data1.error?.includes("Authorization"), "Error message should mention Authorization");
  console.log("✓ Test 1 passed: Missing Authorization header rejected with 401");

  // ---------------------------------------------------------------------------
  // Test 2: Invalid Collector Secret (403 Forbidden)
  // ---------------------------------------------------------------------------
  const req2 = makeRequest(
    {
      message: "OS Assignment 1 due tomorrow",
      sourceGroup: "19CSE312 NLP"
    },
    "Bearer wrong-invalid-secret"
  );
  const res2 = await handleCollectorMessage(req2);
  assert.strictEqual(res2.status, 403, "Invalid secret must return HTTP 403");
  const data2 = await res2.json();
  assert.ok(data2.error?.includes("Invalid"), "Error message should mention Invalid collector secret");
  console.log("✓ Test 2 passed: Invalid collector secret rejected with 403");

  // ---------------------------------------------------------------------------
  // Test 3: Malformed Request Body (400 Bad Request)
  // ---------------------------------------------------------------------------
  const req3 = makeRequest(
    {
      // Missing required sourceGroup
      message: "OS Assignment 1 due tomorrow"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res3 = await handleCollectorMessage(req3);
  assert.strictEqual(res3.status, 400, "Missing required sourceGroup must return HTTP 400");
  const data3 = await res3.json();
  assert.ok(data3.error?.includes("Malformed"), "Error message should specify Malformed request payload");
  console.log("✓ Test 3 passed: Malformed request body rejected with 400");

  // ---------------------------------------------------------------------------
  // Test 4: Valid WhatsApp Academic Message Ingestion (201 Created)
  // ---------------------------------------------------------------------------
  const runTag = Date.now().toString().slice(-4);
  const validMessage = `OS Assignment ${runTag} submission deadline is 12 October at 11:59 PM: https://forms.gle/os-${runTag}`;
  const req4 = makeRequest(
    {
      message: validMessage,
      sourceGroup: "19CSE312 NLP",
      sourceSender: "OS Faculty",
      messageTimestamp: "2026-10-01T09:30:00Z",
      sourceMessageId: `wamid.HBgL${runTag}`
    },
    `Bearer ${TEST_SECRET}`
  );
  const res4 = await handleCollectorMessage(req4);
  assert.strictEqual(res4.status, 201, "New academic message must return HTTP 201");
  const data4 = await res4.json();
  assert.strictEqual(data4.success, true);
  assert.strictEqual(data4.action, "CREATED");
  assert.ok(data4.item?.id, "Created event must have a database ID");
  assert.strictEqual(data4.item?.submissionUrl, `https://forms.gle/os-${runTag}`);
  console.log("✓ Test 4 passed: Valid WhatsApp academic message processed & event created");

  // ---------------------------------------------------------------------------
  // Test 5: Source Metadata Preservation
  // ---------------------------------------------------------------------------
  const rawList = await getRawMessages(5);
  const foundRaw = rawList.find(r => r.messageText === validMessage);
  assert.ok(foundRaw, "Raw message must be stored in database");
  assert.strictEqual(foundRaw.source, "WHATSAPP_WEB", "Source must be preserved as WHATSAPP_WEB");
  assert.strictEqual(foundRaw.sourceGroup, "19CSE312 NLP", "sourceGroup must match");
  assert.strictEqual(foundRaw.sourceSender, "OS Faculty", "sourceSender must match");
  assert.strictEqual(foundRaw.sourceMessageId, `wamid.HBgL${runTag}`, "sourceMessageId must be recorded");
  console.log("✓ Test 5 passed: Source metadata preserved in raw_messages (source=WHATSAPP_WEB)");

  // ---------------------------------------------------------------------------
  // Test 6: Ordinary Chatter Filtering (Non-Academic)
  // ---------------------------------------------------------------------------
  const req6 = makeRequest(
    {
      message: "Good morning sir! Happy birthday 🎂🎉",
      sourceGroup: "19CSE312 NLP",
      sourceSender: "Student A"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res6 = await handleCollectorMessage(req6);
  assert.strictEqual(res6.status, 200);
  const data6 = await res6.json();
  assert.strictEqual(data6.action, "NON_ACADEMIC", "Casual greetings must be classified as NON_ACADEMIC");
  console.log("✓ Test 6 passed: Ordinary chatter classified as NON_ACADEMIC and filtered");

  // ---------------------------------------------------------------------------
  // Test 7: Duplicate Message Ignored via Deduplication
  // ---------------------------------------------------------------------------
  const req7 = makeRequest(
    {
      message: validMessage,
      sourceGroup: "19CSE312 NLP",
      sourceSender: "OS Faculty"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res7 = await handleCollectorMessage(req7);
  assert.strictEqual(res7.status, 200);
  const data7 = await res7.json();
  assert.strictEqual(data7.action, "IGNORED_DUPLICATE", "Duplicate message must return IGNORED_DUPLICATE");
  console.log("✓ Test 7 passed: Duplicate message detected and safely ignored");

  // ---------------------------------------------------------------------------
  // Test 8: Postponement Message Updates Existing Event & Records Change History
  // ---------------------------------------------------------------------------
  const slipTestTag = Date.now().toString().slice(-4);
  const initialSlipTest = `Slip Test ${slipTestTag} on 30-09-2026 during 2nd period`;
  const req8a = makeRequest(
    {
      message: initialSlipTest,
      sourceGroup: "19CSE312 NLP",
      sourceSender: "Prof Krishna"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res8a = await handleCollectorMessage(req8a);
  const data8a = await res8a.json();
  assert.strictEqual(data8a.action, "CREATED");
  const slipEventId = data8a.item.id;

  const postponementMsg = `Slip Test ${slipTestTag} has been postponed from 30 September to 3 October.`;
  const req8b = makeRequest(
    {
      message: postponementMsg,
      sourceGroup: "19CSE312 NLP",
      sourceSender: "Prof Krishna"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res8b = await handleCollectorMessage(req8b);
  assert.strictEqual(res8b.status, 200);
  const data8b = await res8b.json();
  assert.strictEqual(data8b.action, "UPDATED", "Postponement must update existing event");
  assert.strictEqual(data8b.item?.id, slipEventId, "Must update SAME event, not create duplicate");
  assert.strictEqual(data8b.item?.eventDate, "2026-10-03", "Event date must be updated to 3 Oct");
  assert.strictEqual(data8b.item?.status, "POSTPONED", "Event status must be POSTPONED");
  assert.ok(data8b.item?.changeHistory?.length >= 1, "Change history must record the postponement");
  console.log("✓ Test 8 passed: Postponement message updates existing event without duplicates");

  // ---------------------------------------------------------------------------
  // Test 9: Cancellation Message Records Status and History
  // ---------------------------------------------------------------------------
  const cancelMsg = `Slip Test ${slipTestTag} is cancelled due to guest lecture.`;
  const req9 = makeRequest(
    {
      message: cancelMsg,
      sourceGroup: "19CSE312 NLP",
      sourceSender: "Prof Krishna"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res9 = await handleCollectorMessage(req9);
  const data9 = await res9.json();
  assert.strictEqual(data9.action, "UPDATED");
  assert.strictEqual(data9.item?.status, "CANCELLED");
  console.log("✓ Test 9 passed: Cancellation message updates status to CANCELLED");

  // ---------------------------------------------------------------------------
  // Test 10: Ambiguous Deadline Handled with needsConfirmation
  // ---------------------------------------------------------------------------
  const ambMsg = `Please submit this soon. Ref: ${slipTestTag}`;
  const req10 = makeRequest(
    {
      message: ambMsg,
      sourceGroup: "General Class",
      sourceSender: "Faculty"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res10 = await handleCollectorMessage(req10);
  const data10 = await res10.json();
  assert.strictEqual(data10.action, "CREATED");
  assert.strictEqual(data10.item?.needsConfirmation, true, "Ambiguous deadline must set needsConfirmation = true");
  assert.strictEqual(data10.item?.deadline, undefined, "Missing deadline must not be hallucinated");
  console.log("✓ Test 10 passed: Ambiguous deadline marked needsConfirmation=true without fake date");

  // ---------------------------------------------------------------------------
  // Test 11: Collector Metrics Tracking
  // ---------------------------------------------------------------------------
  const stats = getCollectorStats();
  assert.ok(stats.totalReceived >= 6, "Total received messages must be tracked");
  assert.ok(stats.nonAcademic >= 1, "Non-academic messages count must be tracked");
  assert.ok(stats.duplicate >= 1, "Duplicate messages count must be tracked");
  assert.ok(stats.eventsCreated >= 2, "Created events count must be tracked");
  assert.ok(stats.eventsUpdated >= 2, "Updated events count must be tracked");
  assert.strictEqual(stats.endpointStatus, "CONFIGURED");
  console.log("✓ Test 11 passed: Collector KPI metrics tracking verified");

  // ---------------------------------------------------------------------------
  // Test 12: No Secret Leakage in API Responses
  // ---------------------------------------------------------------------------
  const responseJsonStr = JSON.stringify(data4);
  assert.strictEqual(responseJsonStr.includes(TEST_SECRET), false, "COLLECTOR_SECRET must not leak in response");
  assert.strictEqual(responseJsonStr.includes("GEMINI_API_KEY"), false, "GEMINI_API_KEY must not leak in response");
  assert.strictEqual(responseJsonStr.includes("SUPABASE_SERVICE_ROLE_KEY"), false, "SUPABASE key must not leak");
  assert.strictEqual(responseJsonStr.includes("NOTION_TOKEN"), false, "NOTION token must not leak");
  console.log("✓ Test 12 passed: Zero secret leakage in API responses");

  console.log("\n============================================================");
  console.log("ALL 12 PHASE 4A COLLECTOR TESTS PASSED CLEANLY! 🎉");
  console.log("============================================================\n");
}

runPhase4ATests().catch(err => {
  console.error("Phase 4A Test Failure:", err);
  process.exit(1);
});
