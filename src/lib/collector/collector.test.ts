import assert from "node:assert";
import { POST as handleCollectorMessage } from "../../app/api/collector/messages/route";
import { POST as handleCollectorStatus, GET as getCollectorStatusApi } from "../../app/api/collector/status/route";
import { processAcademicMessagePipeline } from "../messages/processor";
import { hashMessage, isMessageProcessed, getRawMessages } from "../db/rawMessages";
import { getAllAcademicEvents, getAcademicEventById } from "../db/academicEvents";
import { getCollectorStats, resetCollectorStats } from "./stats";
import { detectIsGroupChat } from "./group-detection";

console.log("=== RUNNING PHASE 4A: WHATSAPP WEB COLLECTOR TEST SUITE ===");

async function runPhase4ATests() {
  const TEST_SECRET = "test-collector-secret-4a";
  process.env.COLLECTOR_SECRET = TEST_SECRET;
  resetCollectorStats();

  // Helper to create mock Next.js Request
  function makeRequest(body: any, authHeader?: string, url = "http://localhost:3000/api/collector/messages") {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    if (authHeader !== undefined) {
      headers.set("Authorization", authHeader);
    }
    return new Request(url, {
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
    sourceGroup: "CSE-C Official 2024"
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
      sourceGroup: "CSE-C Official 2024"
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
  // Test 4: Group Chat Detection Heuristic (detectIsGroupChat)
  // ---------------------------------------------------------------------------
  // 4a: Detected via Header Action Label
  assert.strictEqual(
    detectIsGroupChat({
      chatName: "CSE-C Official 2024",
      headerActionLabel: "Group info"
    }),
    true,
    "Header Action Label 'Group info' must detect group"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "CSE Community Announcements",
      headerActionLabel: "Community info"
    }),
    true,
    "Header Action Label 'Community info' must detect group"
  );

  // 4b: Detected via Participant Subtitle
  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Machine Learning CSE-C",
      subtitleText: "Alice, Bob, Charlie, You"
    }),
    true,
    "Subtitle with participant names must detect group"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Computer Networks CSE-C",
      subtitleText: "64 participants"
    }),
    true,
    "Subtitle with 'participants' count must detect group"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "TOC 23CSE303 - CSE-C",
      subtitleText: "Click here for group info"
    }),
    true,
    "Subtitle with 'group info' prompt must detect group"
  );

  // 4c: Detected via Header Icons
  assert.strictEqual(
    detectIsGroupChat({
      chatName: "BTECH SEM V-SOFT SKILLS-CSE",
      headerIcons: ["default-group"]
    }),
    true,
    "Header icon containing 'group' must detect group"
  );

  // 4d: Detected via Message Bubble Author Headers
  assert.strictEqual(
    detectIsGroupChat({
      chatName: "General",
      hasAuthorHeadersOnMessages: true
    }),
    true,
    "Presence of author headers above messages must detect group"
  );

  console.log("✓ Test 4 passed: Group chats accurately identified across all DOM heuristics");

  // ---------------------------------------------------------------------------
  // Test 5: Personal 1-to-1 Chat Rejection (Privacy Boundary)
  // ---------------------------------------------------------------------------
  assert.strictEqual(
    detectIsGroupChat({
      chatName: "John Doe (Personal Friend)",
      subtitleText: "online"
    }),
    false,
    "Personal chat with 'online' subtitle must be rejected"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Mom",
      subtitleText: "last seen today at 10:15 am"
    }),
    false,
    "Personal chat with 'last seen...' subtitle must be rejected"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Batchmate Friend",
      subtitleText: "typing..."
    }),
    false,
    "Personal chat with 'typing...' subtitle must be rejected"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Unknown Contact",
      headerActionLabel: "Contact info"
    }),
    false,
    "Header Action Label 'Contact info' must reject personal chat"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Individual Colleague",
      headerIcons: ["default-user"]
    }),
    false,
    "Avatar icon 'default-user' must reject personal chat"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: null
    }),
    false,
    "Null chatName must be rejected"
  );

  console.log("✓ Test 5 passed: Personal 1-to-1 chats strictly rejected (privacy boundary)");

  // ---------------------------------------------------------------------------
  // Test 6: New / Arbitrary Group Automatically Accepted (No Allowlist Required)
  // ---------------------------------------------------------------------------
  const arbitraryGroups = [
    "CSE-C Official 2024",
    "Machine Learning CSE-C",
    "Computer Networks CSE-C",
    "TOC 23CSE303 - CSE-C",
    "BTECH SEM V-SOFT SKILLS-CSE",
    "General",
    "New College Club 2027"
  ];

  for (const groupName of arbitraryGroups) {
    const isDetected = detectIsGroupChat({
      chatName: groupName,
      subtitleText: "You, +91 9876543210, +91 9123456780"
    });
    assert.strictEqual(isDetected, true, `New group '${groupName}' should be accepted without preconfiguration`);
  }
  console.log("✓ Test 6 passed: Any new arbitrary group automatically accepted without allowlist");

  // ---------------------------------------------------------------------------
  // Test 7: Valid Academic Message Ingestion from Arbitrary Group (201 Created)
  // ---------------------------------------------------------------------------
  const runTag = Date.now().toString().slice(-4);
  const validMessage = `OS Assignment ${runTag} submission deadline is 12 October at 11:59 PM: https://forms.gle/os-${runTag}`;
  const req7 = makeRequest(
    {
      message: validMessage,
      sourceGroup: "CSE-C Official 2024",
      sourceSender: "OS Faculty",
      messageTimestamp: "2026-10-01T09:30:00Z",
      sourceMessageId: `wamid.HBgL${runTag}`
    },
    `Bearer ${TEST_SECRET}`
  );
  const res7 = await handleCollectorMessage(req7);
  assert.strictEqual(res7.status, 201, "New academic message from arbitrary group must return HTTP 201");
  const data7 = await res7.json();
  assert.strictEqual(data7.success, true);
  assert.strictEqual(data7.action, "CREATED");
  assert.ok(data7.item?.id, "Created event must have a database ID");
  assert.strictEqual(data7.item?.submissionUrl, `https://forms.gle/os-${runTag}`);
  console.log("✓ Test 7 passed: Valid academic message ingested from 'CSE-C Official 2024'");

  // ---------------------------------------------------------------------------
  // Test 8: Source Metadata Preservation
  // ---------------------------------------------------------------------------
  const rawList = await getRawMessages(5);
  const foundRaw = rawList.find(r => r.messageText === validMessage);
  assert.ok(foundRaw, "Raw message must be stored in database");
  assert.strictEqual(foundRaw.source, "WHATSAPP_WEB", "Source must be preserved as WHATSAPP_WEB");
  assert.strictEqual(foundRaw.sourceGroup, "CSE-C Official 2024", "sourceGroup must match");
  assert.strictEqual(foundRaw.sourceSender, "OS Faculty", "sourceSender must match");
  assert.strictEqual(foundRaw.sourceMessageId, `wamid.HBgL${runTag}`, "sourceMessageId must be recorded");
  console.log("✓ Test 8 passed: Source metadata preserved in raw_messages (source=WHATSAPP_WEB)");

  // ---------------------------------------------------------------------------
  // Test 9: Ordinary Chatter Filtering (Non-Academic in Group)
  // ---------------------------------------------------------------------------
  const req9 = makeRequest(
    {
      message: "Good morning sir! Happy birthday 🎂🎉",
      sourceGroup: "CSE-C Official 2024",
      sourceSender: "Student A"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res9 = await handleCollectorMessage(req9);
  assert.strictEqual(res9.status, 200);
  const data9 = await res9.json();
  assert.strictEqual(data9.action, "NON_ACADEMIC", "Casual greetings must be classified as NON_ACADEMIC");
  console.log("✓ Test 9 passed: Ordinary chatter classified as NON_ACADEMIC and filtered");

  // ---------------------------------------------------------------------------
  // Test 10: Duplicate Message Protection
  // ---------------------------------------------------------------------------
  const req10 = makeRequest(
    {
      message: validMessage,
      sourceGroup: "CSE-C Official 2024",
      sourceSender: "OS Faculty"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res10 = await handleCollectorMessage(req10);
  assert.strictEqual(res10.status, 200);
  const data10 = await res10.json();
  assert.strictEqual(data10.action, "IGNORED_DUPLICATE", "Duplicate message must return IGNORED_DUPLICATE");
  console.log("✓ Test 10 passed: Duplicate message detected and safely ignored");

  // ---------------------------------------------------------------------------
  // Test 11: Switching Between Groups Updates Collector Chat State
  // ---------------------------------------------------------------------------
  // Switch to Machine Learning CSE-C
  const switchReq1 = makeRequest(
    {
      currentGroup: "Machine Learning CSE-C",
      chatType: "GROUP",
      collectionStatus: "ACTIVE"
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/status"
  );
  const switchRes1 = await handleCollectorStatus(switchReq1);
  assert.strictEqual(switchRes1.status, 200);
  let liveStats = getCollectorStats();
  assert.strictEqual(liveStats.currentGroup, "Machine Learning CSE-C");
  assert.strictEqual(liveStats.chatType, "GROUP");
  assert.strictEqual(liveStats.collectionStatus, "ACTIVE");

  // Switch to Personal Chat -> Ignored
  const switchReq2 = makeRequest(
    {
      currentGroup: "Roommate Friend",
      chatType: "PERSONAL",
      collectionStatus: "IGNORED"
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/status"
  );
  const switchRes2 = await handleCollectorStatus(switchReq2);
  assert.strictEqual(switchRes2.status, 200);
  liveStats = getCollectorStats();
  assert.strictEqual(liveStats.currentGroup, "Roommate Friend");
  assert.strictEqual(liveStats.chatType, "PERSONAL");
  assert.strictEqual(liveStats.collectionStatus, "IGNORED");

  // Switch to another group: TOC 23CSE303 - CSE-C
  const switchReq3 = makeRequest(
    {
      currentGroup: "TOC 23CSE303 - CSE-C",
      chatType: "GROUP",
      collectionStatus: "ACTIVE"
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/status"
  );
  const switchRes3 = await handleCollectorStatus(switchReq3);
  assert.strictEqual(switchRes3.status, 200);
  liveStats = getCollectorStats();
  assert.strictEqual(liveStats.currentGroup, "TOC 23CSE303 - CSE-C");
  assert.strictEqual(liveStats.chatType, "GROUP");
  assert.strictEqual(liveStats.collectionStatus, "ACTIVE");
  console.log("✓ Test 11 passed: Switching between groups and personal chat updates collector status correctly");

  // ---------------------------------------------------------------------------
  // Test 12: Academic Message from another group (e.g. "General")
  // ---------------------------------------------------------------------------
  const genTag = Date.now().toString().slice(-4);
  const genMsg = `Semester Exam timetable has been published. Mid-terms start from 20 Nov: https://portal.college.edu/exams-${genTag}`;
  const req12 = makeRequest(
    {
      message: genMsg,
      sourceGroup: "General",
      sourceSender: "Dean Academics",
      messageTimestamp: "2026-10-02T10:00:00Z",
      sourceMessageId: `wamid.GEN${genTag}`
    },
    `Bearer ${TEST_SECRET}`
  );
  const res12 = await handleCollectorMessage(req12);
  assert.strictEqual(res12.status, 201);
  const data12 = await res12.json();
  assert.strictEqual(data12.action, "CREATED");
  assert.strictEqual(data12.item?.sourceGroup, "General");
  console.log("✓ Test 12 passed: Academic message from generic group 'General' accepted and processed");

  // ---------------------------------------------------------------------------
  // Test 13: Postponement Message Updates Existing Event & Records Change History
  // ---------------------------------------------------------------------------
  const slipTestTag = Date.now().toString().slice(-4);
  const initialSlipTest = `Slip Test ${slipTestTag} on 30-09-2026 during 2nd period`;
  const req13a = makeRequest(
    {
      message: initialSlipTest,
      sourceGroup: "CSE-C Official 2024",
      sourceSender: "Prof Krishna"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res13a = await handleCollectorMessage(req13a);
  const data13a = await res13a.json();
  assert.strictEqual(data13a.action, "CREATED");
  const slipEventId = data13a.item.id;

  const postponementMsg = `Slip Test ${slipTestTag} has been postponed from 30 September to 3 October.`;
  const req13b = makeRequest(
    {
      message: postponementMsg,
      sourceGroup: "CSE-C Official 2024",
      sourceSender: "Prof Krishna"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res13b = await handleCollectorMessage(req13b);
  assert.strictEqual(res13b.status, 200);
  const data13b = await res13b.json();
  assert.strictEqual(data13b.action, "UPDATED", "Postponement must update existing event");
  assert.strictEqual(data13b.item?.id, slipEventId, "Must update SAME event, not create duplicate");
  assert.strictEqual(data13b.item?.eventDate, "2026-10-03", "Event date must be updated to 3 Oct");
  assert.strictEqual(data13b.item?.status, "POSTPONED", "Event status must be POSTPONED");
  assert.ok(data13b.item?.changeHistory?.length >= 1, "Change history must record the postponement");
  console.log("✓ Test 13 passed: Postponement message updates existing event without duplicates");

  // ---------------------------------------------------------------------------
  // Test 14: Collector Metrics Tracking
  // ---------------------------------------------------------------------------
  const stats = getCollectorStats();
  assert.ok(stats.totalReceived >= 5, "Total received messages must be tracked");
  assert.ok(stats.nonAcademic >= 1, "Non-academic messages count must be tracked");
  assert.ok(stats.duplicate >= 1, "Duplicate messages count must be tracked");
  assert.ok(stats.eventsCreated >= 3, "Created events count must be tracked");
  assert.strictEqual(stats.endpointStatus, "CONFIGURED");
  console.log("✓ Test 14 passed: Collector KPI metrics tracking verified");

  // ---------------------------------------------------------------------------
  // Test 15: No Secret Leakage in API Responses
  // ---------------------------------------------------------------------------
  const responseJsonStr = JSON.stringify(data7);
  assert.strictEqual(responseJsonStr.includes(TEST_SECRET), false, "COLLECTOR_SECRET must not leak in response");
  assert.strictEqual(responseJsonStr.includes("GEMINI_API_KEY"), false, "GEMINI_API_KEY must not leak in response");
  assert.strictEqual(responseJsonStr.includes("SUPABASE_SERVICE_ROLE_KEY"), false, "SUPABASE key must not leak");
  assert.strictEqual(responseJsonStr.includes("NOTION_TOKEN"), false, "NOTION token must not leak");
  console.log("✓ Test 15 passed: Zero secret leakage in API responses");

  console.log("\n============================================================");
  console.log("ALL 15 PHASE 4A COLLECTOR TESTS PASSED CLEANLY! 🎉");
  console.log("============================================================\n");
}

runPhase4ATests().catch(err => {
  console.error("Phase 4A Test Failure:", err);
  process.exit(1);
});

