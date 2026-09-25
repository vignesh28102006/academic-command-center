import assert from "node:assert";
import { POST as handleCollectorMessage } from "../../app/api/collector/messages/route";
import { POST as handleCollectorStatus, GET as getCollectorStatusApi } from "../../app/api/collector/status/route";
import { POST as registerCollectorGroupApi, GET as getCollectorGroupsApi } from "../../app/api/collector/groups/route";
import { GET as getCollectorGroupByIdApi } from "../../app/api/collector/groups/[id]/route";
import { PATCH as updateCollectorCursorApi } from "../../app/api/collector/groups/[id]/cursor/route";
import { POST as saveCollectorScanApi, GET as getCollectorScansApi } from "../../app/api/collector/scans/route";
import { isMessageEligibleForBackfill, isMessageNewerThanCursor } from "../dateUtils";
import { processAcademicMessagePipeline } from "../messages/processor";
import { hashMessage, isMessageProcessed, getRawMessages } from "../db/rawMessages";
import { getAllAcademicEvents, getAcademicEventById } from "../db/academicEvents";
import { getCollectorStats, resetCollectorStats } from "./stats";
import { detectIsGroupChat } from "./group-detection";

console.log("=== RUNNING PHASE 4A/4B: WHATSAPP WEB COLLECTOR TEST SUITE ===");

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
    "CSE-C Announcements",
    "23cse351 FoDS G1",
    "NLP 2026 batch",
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

  // ---------------------------------------------------------------------------
  // Test 16: Ingestion from 'NLP 2026 batch' with Subject Mapping to NLP
  // ---------------------------------------------------------------------------
  const nlpMsgTag = Date.now().toString().slice(-4);
  const nlpMessage = `Assignment on Word Embeddings and Tokenization due 15 October at 11:59 PM: https://forms.gle/nlp-${nlpMsgTag}`;
  const req16 = makeRequest(
    {
      message: nlpMessage,
      sourceGroup: "NLP 2026 batch",
      sourceSender: "NLP Faculty Dr Sharma",
      messageTimestamp: "2026-10-02T10:00:00Z"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res16 = await handleCollectorMessage(req16);
  assert.strictEqual(res16.status, 201, "Message from 'NLP 2026 batch' must be accepted and ingested");
  const data16 = await res16.json();
  assert.strictEqual(data16.success, true);
  assert.strictEqual(data16.item?.subject, "NLP", "Subject must resolve to 'NLP' from 'NLP 2026 batch'");
  assert.strictEqual(data16.item?.sourceGroup, "NLP 2026 batch", "sourceGroup must be preserved as 'NLP 2026 batch'");
  console.log("✓ Test 16 passed: 'NLP 2026 batch' message accepted with subject mapped to NLP");

  // ---------------------------------------------------------------------------
  // Test 17: Ingestion from '23cse351 FoDS G1' with Subject Mapping to FoDS
  // ---------------------------------------------------------------------------
  const fodsMsgTag = Date.now().toString().slice(-4);
  const fodsMessage = `FoDS Lab Exercise 3 on Data Wrangling deadline is 18 October at 11:59 PM: https://forms.gle/fods-${fodsMsgTag}`;
  const req17 = makeRequest(
    {
      message: fodsMessage,
      sourceGroup: "23cse351 FoDS G1",
      sourceSender: "FoDS Faculty",
      messageTimestamp: "2026-10-02T11:00:00Z"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res17 = await handleCollectorMessage(req17);
  assert.strictEqual(res17.status, 201, "Message from '23cse351 FoDS G1' must be accepted and ingested");
  const data17 = await res17.json();
  assert.strictEqual(data17.success, true);
  assert.strictEqual(data17.item?.subject, "FoDS", "Subject must resolve to 'FoDS' from '23cse351 FoDS G1'");
  assert.strictEqual(data17.item?.sourceGroup, "23cse351 FoDS G1", "sourceGroup must be preserved as '23cse351 FoDS G1'");
  console.log("✓ Test 17 passed: '23cse351 FoDS G1' message accepted with subject mapped to FoDS");

  // ---------------------------------------------------------------------------
  // Test 18: Ingestion from 'CSE-C Announcements' Group
  // ---------------------------------------------------------------------------
  const announceMsg = `Class will be held in Seminar Hall B tomorrow at 9:00 AM instead of Lab 3.`;
  const req18 = makeRequest(
    {
      message: announceMsg,
      sourceGroup: "CSE-C Announcements",
      sourceSender: "Class Representative",
      messageTimestamp: "2026-10-02T12:00:00Z"
    },
    `Bearer ${TEST_SECRET}`
  );
  const res18 = await handleCollectorMessage(req18);
  assert.strictEqual(res18.status, 201, "Message from 'CSE-C Announcements' must be accepted and ingested");
  const data18 = await res18.json();
  assert.strictEqual(data18.success, true);
  assert.strictEqual(data18.item?.sourceGroup, "CSE-C Announcements", "sourceGroup must be preserved as 'CSE-C Announcements'");
  console.log("✓ Test 18 passed: 'CSE-C Announcements' message accepted and ingested");

  // ---------------------------------------------------------------------------
  // Test 19: September 10, 2026 Backfill Boundary Filtering
  // ---------------------------------------------------------------------------
  // Messages prior to September 10, 2026 must be strictly ignored
  assert.strictEqual(
    isMessageEligibleForBackfill("2026-09-09T23:59:59+05:30"),
    false,
    "Message from Sept 9 must NOT be eligible for backfill"
  );
  assert.strictEqual(
    isMessageEligibleForBackfill("2026-09-10T00:00:00+05:30"),
    true,
    "Message at midnight Sept 10 MUST be eligible for backfill"
  );
  assert.strictEqual(
    isMessageEligibleForBackfill("2026-09-20T12:00:00+05:30"),
    true,
    "Message after Sept 10 MUST be eligible for backfill"
  );

  // Sending an out-of-boundary message to the collector API
  const oldMessageReq = makeRequest(
    {
      message: "Old announcement from early September",
      sourceGroup: "CSE-C Official 2024",
      sourceSender: "Faculty",
      messageTimestamp: "2026-09-05T10:00:00+05:30"
    },
    `Bearer ${TEST_SECRET}`
  );
  const oldMessageRes = await handleCollectorMessage(oldMessageReq);
  assert.strictEqual(oldMessageRes.status, 200);
  const oldMessageData = await oldMessageRes.json();
  assert.strictEqual(oldMessageData.action, "IGNORED_OUT_OF_RANGE");
  console.log("✓ Test 19 passed: September 10, 2026 backfill boundary filtering strictly enforced");

  // ---------------------------------------------------------------------------
  // Test 20: Persistent Per-Group Registration & Cursors (/api/collector/groups)
  // ---------------------------------------------------------------------------
  const groupRegReq = makeRequest(
    {
      groupName: "CSE-C Core 2026",
      groupIdentifier: "CSE-C Core 2026"
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/groups"
  );
  const groupRegRes = await registerCollectorGroupApi(groupRegReq);
  assert.strictEqual(groupRegRes.status, 201);
  const groupRegData = await groupRegRes.json();
  assert.strictEqual(groupRegData.group.groupName, "CSE-C Core 2026");
  assert.ok(groupRegData.group.firstBackfillDate.startsWith("2026-09-10"));
  assert.strictEqual(groupRegData.group.backfillComplete, false);

  const getGroupsReq = new Request("http://localhost:3000/api/collector/groups");
  const getGroupsRes = await getCollectorGroupsApi(getGroupsReq);
  const getGroupsData = await getGroupsRes.json();
  assert.ok(getGroupsData.groups.some((g: any) => g.groupName === "CSE-C Core 2026"));
  console.log("✓ Test 20 passed: Group registration and default backfill date (2026-09-10) verified");

  // ---------------------------------------------------------------------------
  // Test 21: Persistent Per-Group Cursor Updates (PATCH /cursor)
  // ---------------------------------------------------------------------------
  const cursorUpdateReq = makeRequest(
    {
      lastProcessedMessageTimestamp: "2026-09-15T10:00:00.000Z",
      lastProcessedMessageId: "wamid.TEST_MSG_1",
      backfillComplete: true,
      status: "MONITORING",
      messagesScannedIncrement: 45,
      messagesProcessedIncrement: 5,
      messagesIgnoredIncrement: 40
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/groups/CSE-C%20Core%202026/cursor"
  );
  const cursorUpdateRes = await updateCollectorCursorApi(cursorUpdateReq, {
    params: Promise.resolve({ id: "CSE-C Core 2026" })
  });
  assert.strictEqual(cursorUpdateRes.status, 200);
  const cursorUpdateData = await cursorUpdateRes.json();
  assert.strictEqual(cursorUpdateData.group.backfillComplete, true);
  assert.strictEqual(cursorUpdateData.group.lastProcessedMessageTimestamp, "2026-09-15T10:00:00.000Z");
  assert.strictEqual(cursorUpdateData.group.status, "MONITORING");
  assert.strictEqual(cursorUpdateData.group.messagesScanned, 45);

  const getSingleGroupReq = new Request("http://localhost:3000/api/collector/groups/CSE-C%20Core%202026");
  const getSingleGroupRes = await getCollectorGroupByIdApi(getSingleGroupReq, {
    params: Promise.resolve({ id: "CSE-C Core 2026" })
  });
  const getSingleGroupData = await getSingleGroupRes.json();
  assert.strictEqual(getSingleGroupData.group.backfillComplete, true);
  assert.strictEqual(getSingleGroupData.group.lastProcessedMessageTimestamp, "2026-09-15T10:00:00.000Z");
  console.log("✓ Test 21 passed: Persistent per-group cursor updates and retrieval verified");

  // ---------------------------------------------------------------------------
  // Test 22: Incremental Scanning (Resuming from Cursor, Never Rescanning Sept 10)
  // ---------------------------------------------------------------------------
  const currentCursor = cursorUpdateData.group.lastProcessedMessageTimestamp;
  assert.strictEqual(
    isMessageNewerThanCursor("2026-09-14T09:00:00.000Z", currentCursor),
    false,
    "Messages older than saved cursor must be skipped (no rescan from Sept 10)"
  );
  assert.strictEqual(
    isMessageNewerThanCursor("2026-09-15T10:00:00.000Z", currentCursor),
    false,
    "Message matching exact cursor timestamp must not be re-processed"
  );
  assert.strictEqual(
    isMessageNewerThanCursor("2026-09-16T12:00:00.000Z", currentCursor),
    true,
    "Message newer than saved cursor must be eligible for incremental processing"
  );
  console.log("✓ Test 22 passed: Incremental scan correctly resumes from cursor without re-scanning");

  // ---------------------------------------------------------------------------
  // Test 23: Per-Group Independence (Group A cursor != Group B cursor)
  // ---------------------------------------------------------------------------
  const groupBReq = makeRequest(
    {
      groupName: "23cse351 FoDS G1",
      groupIdentifier: "23cse351 FoDS G1"
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/groups"
  );
  await registerCollectorGroupApi(groupBReq);

  const groupBCursorReq = makeRequest(
    {
      lastProcessedMessageTimestamp: "2026-09-20T18:00:00.000Z",
      lastProcessedMessageId: "wamid.FODS_MSG_9",
      backfillComplete: true,
      status: "IDLE"
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/groups/23cse351%20FoDS%20G1/cursor"
  );
  await updateCollectorCursorApi(groupBCursorReq, {
    params: Promise.resolve({ id: "23cse351 FoDS G1" })
  });

  const checkGroupARes = await getCollectorGroupByIdApi(
    new Request("http://localhost:3000/api/collector/groups/CSE-C%20Core%202026"),
    { params: Promise.resolve({ id: "CSE-C Core 2026" }) }
  );
  const checkGroupAData = await checkGroupARes.json();

  const checkGroupBRes = await getCollectorGroupByIdApi(
    new Request("http://localhost:3000/api/collector/groups/23cse351%20FoDS%20G1"),
    { params: Promise.resolve({ id: "23cse351 FoDS G1" }) }
  );
  const checkGroupBData = await checkGroupBRes.json();

  assert.strictEqual(checkGroupAData.group.lastProcessedMessageTimestamp, "2026-09-15T10:00:00.000Z");
  assert.strictEqual(checkGroupBData.group.lastProcessedMessageTimestamp, "2026-09-20T18:00:00.000Z");
  assert.notStrictEqual(
    checkGroupAData.group.lastProcessedMessageTimestamp,
    checkGroupBData.group.lastProcessedMessageTimestamp,
    "Group A and Group B cursors must be fully independent"
  );
  console.log("✓ Test 23 passed: Group cursors operate independently across different WhatsApp groups");

  // ---------------------------------------------------------------------------
  // Test 24: Scan History Tracking (/api/collector/scans)
  // ---------------------------------------------------------------------------
  const scanStartReq = makeRequest(
    {
      status: "IN_PROGRESS",
      groupsDiscovered: 4,
      groupsCompleted: 0,
      groupsFailed: 0,
      messagesScanned: 0,
      messagesProcessed: 0,
      messagesIgnored: 0,
      eventsCreated: 0,
      eventsUpdated: 0
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/scans"
  );
  const scanStartRes = await saveCollectorScanApi(scanStartReq);
  assert.strictEqual(scanStartRes.status, 201);
  const scanStartData = await scanStartRes.json();
  const scanId = scanStartData.scan.id;
  assert.ok(scanId);
  assert.strictEqual(scanStartData.scan.status, "IN_PROGRESS");

  const scanEndReq = makeRequest(
    {
      id: scanId,
      completedAt: new Date().toISOString(),
      status: "COMPLETED",
      groupsCompleted: 4,
      messagesScanned: 120,
      messagesProcessed: 8,
      messagesIgnored: 112,
      eventsCreated: 2,
      eventsUpdated: 1
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/scans"
  );
  const scanEndRes = await saveCollectorScanApi(scanEndReq);
  const scanEndData = await scanEndRes.json();
  assert.strictEqual(scanEndData.scan.status, "COMPLETED");
  assert.strictEqual(scanEndData.scan.groupsCompleted, 4);

  const getScansReq = new Request("http://localhost:3000/api/collector/scans");
  const getScansRes = await getCollectorScansApi(getScansReq);
  const getScansData = await getScansRes.json();
  assert.ok(getScansData.scans.some((s: any) => s.id === scanId));
  console.log("✓ Test 24 passed: Scan history cycle lifecycle (IN_PROGRESS -> COMPLETED) tracked accurately");

  // ---------------------------------------------------------------------------
  // Test 25: Failed Processing Cursor Hold (Cursor Does NOT Advance Past Failure)
  // ---------------------------------------------------------------------------
  const preFailGroupRes = await getCollectorGroupByIdApi(
    new Request("http://localhost:3000/api/collector/groups/CSE-C%20Core%202026"),
    { params: Promise.resolve({ id: "CSE-C Core 2026" }) }
  );
  const preFailData = await preFailGroupRes.json();
  const savedCursorBeforeError = preFailData.group.lastProcessedMessageTimestamp;

  // When error occurs, we record status: ERROR and lastError, but DO NOT advance lastProcessedMessageTimestamp
  const failUpdateReq = makeRequest(
    {
      status: "ERROR",
      lastError: "Network failure parsing message attachment",
      messagesScannedIncrement: 1
      // Note: lastProcessedMessageTimestamp intentionally NOT updated
    },
    `Bearer ${TEST_SECRET}`,
    "http://localhost:3000/api/collector/groups/CSE-C%20Core%202026/cursor"
  );
  const failUpdateRes = await updateCollectorCursorApi(failUpdateReq, {
    params: Promise.resolve({ id: "CSE-C Core 2026" })
  });
  const failUpdateData = await failUpdateRes.json();
  assert.strictEqual(failUpdateData.group.status, "ERROR");
  assert.strictEqual(failUpdateData.group.lastProcessedMessageTimestamp, savedCursorBeforeError);
  assert.strictEqual(failUpdateData.group.lastError, "Network failure parsing message attachment");
  console.log("✓ Test 25 passed: Cursor correctly held at last successful item upon error");

  // ---------------------------------------------------------------------------
  // Test 26: Full Collector Status API Aggregation (GET /api/collector/status)
  // ---------------------------------------------------------------------------
  const statusSummaryRes = await getCollectorStatusApi();
  assert.strictEqual(statusSummaryRes.status, 200);
  const statusSummaryData = await statusSummaryRes.json();
  assert.ok(statusSummaryData.whatsappStatus);
  assert.ok(Array.isArray(statusSummaryData.groups));
  assert.ok(statusSummaryData.groups.length >= 2);
  assert.ok(Array.isArray(statusSummaryData.recentScans));
  assert.ok(statusSummaryData.nextScan, "Next scan schedule timestamp must be calculated");
  assert.ok(statusSummaryData.groupsDiscovered >= 2);
  console.log("✓ Test 26 passed: Complete collector status reporting with 2-hour schedule metrics verified");

  console.log("\n============================================================");
  console.log("ALL 26 PHASE 4A/4B COLLECTOR TESTS PASSED CLEANLY! 🎉");
  console.log("============================================================\n");
}

runPhase4ATests().catch(err => {
  console.error("Phase 4A Test Failure:", err);
  process.exit(1);
});

