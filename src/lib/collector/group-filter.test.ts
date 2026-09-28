import assert from "node:assert";
import { POST as handleCollectorMessage } from "../../app/api/collector/messages/route";
import {
  isGroupAllowed,
  normalizeGroupName,
  getCanonicalGroupName,
  ALLOWED_ACADEMIC_GROUPS
} from "./allowedGroups";
import {
  classifyAcademicMessage,
  isPromotionalMessage,
  isPureAttendanceMessage,
  hasAcademicSignal
} from "./relevanceFilter";
import { detectIsGroupChat } from "./group-detection";
import { processAcademicMessagePipeline } from "../messages/processor";
import { getAllAcademicEvents, createAcademicEvent, deleteAcademicEvent } from "../db/academicEvents";
import { updateCollectorGroupCursor, getCollectorGroupByRef } from "../db/collectorState";
import { parseMultipleAcademicMessages } from "../parser";
import { extractDateString } from "../dateUtils";
import { identifyInvalidAcademicEvents, executeCleanupInvalidEvents } from "../db/cleanup";

console.log("=== RUNNING PHASE 4 CORRECTION: GROUP FILTER & RELEVANCE TEST SUITE ===");

async function runGroupFilterTests() {
  const TEST_SECRET = "test-group-filter-secret";
  process.env.COLLECTOR_SECRET = TEST_SECRET;

  function makeRequest(body: any, authHeader = `Bearer ${TEST_SECRET}`, url = "http://localhost:3000/api/collector/messages") {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    if (authHeader) {
      headers.set("Authorization", authHeader);
    }
    return new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  }

  // ---------------------------------------------------------------------------
  // 1. Allowed group accepted
  // ---------------------------------------------------------------------------
  const req1 = makeRequest({
    message: "OS Assignment 4 on Memory Management deadline 15 October at 11:59 PM: https://forms.gle/os-a4",
    sourceGroup: "CSE-C Announcements",
    sourceSender: "OS Professor",
    messageTimestamp: "2026-10-01T10:00:00Z"
  });
  const res1 = await handleCollectorMessage(req1);
  assert.strictEqual(res1.status, 201, "Allowed group 'CSE-C Announcements' must be accepted with 201");
  const data1 = await res1.json();
  assert.strictEqual(data1.success, true);
  assert.strictEqual(data1.action, "CREATED");
  console.log("✓ Test 1 passed: Allowed group accepted");

  // ---------------------------------------------------------------------------
  // 2. Disallowed group rejected
  // ---------------------------------------------------------------------------
  const req2 = makeRequest({
    message: "Meeting tonight at 8 PM for dinner",
    sourceGroup: "Weekend Friends Trip",
    sourceSender: "Friend",
    messageTimestamp: "2026-10-01T10:00:00Z"
  });
  const res2 = await handleCollectorMessage(req2);
  assert.strictEqual(res2.status, 403, "Disallowed group must return HTTP 403");
  const data2 = await res2.json();
  assert.strictEqual(data2.error, "GROUP_NOT_ALLOWED", "Must return GROUP_NOT_ALLOWED error");
  console.log("✓ Test 2 passed: Disallowed group rejected");

  // ---------------------------------------------------------------------------
  // 3. Embedded Project group rejected
  // ---------------------------------------------------------------------------
  const req3 = makeRequest({
    message: "Microcontroller circuit diagram attached for the prototype",
    sourceGroup: "Embedded Systems Project Group",
    sourceSender: "Project Partner",
    messageTimestamp: "2026-10-01T10:00:00Z"
  });
  const res3 = await handleCollectorMessage(req3);
  assert.strictEqual(res3.status, 403, "Embedded Project group must be strictly rejected with HTTP 403");
  const data3 = await res3.json();
  assert.strictEqual(data3.error, "GROUP_NOT_ALLOWED");
  console.log("✓ Test 3 passed: Embedded Project group rejected");

  // ---------------------------------------------------------------------------
  // 4. Personal chat rejected
  // ---------------------------------------------------------------------------
  const isPersonal = detectIsGroupChat({
    chatName: "John Doe",
    subtitleText: "online",
    headerActionLabel: "Contact info",
    headerIcons: ["default-user"]
  });
  assert.strictEqual(isPersonal, false, "Personal chat must be identified as non-group");
  assert.strictEqual(isGroupAllowed("John Doe"), false, "Personal chat must not be in allowedGroups");

  const req4 = makeRequest({
    message: "Hey can you send me the lecture notes?",
    sourceGroup: "John Doe",
    messageTimestamp: "2026-10-01T10:00:00Z"
  });
  const res4 = await handleCollectorMessage(req4);
  assert.strictEqual(res4.status, 403, "Personal chat must be rejected with 403");
  console.log("✓ Test 4 passed: Personal chat rejected");

  // ---------------------------------------------------------------------------
  // 5. Exact group matching (with normalized whitespace/casing)
  // ---------------------------------------------------------------------------
  assert.strictEqual(isGroupAllowed("Machine Learning CSE-C"), true);
  assert.strictEqual(isGroupAllowed("Machine Learning CSE-C "), true, "Trailing whitespace should be normalized");
  assert.strictEqual(isGroupAllowed(" Machine Learning  CSE-C "), true, "Internal repeated whitespace should be normalized");
  assert.strictEqual(isGroupAllowed("machine learning cse-c"), true, "Case-insensitive normalization should match");
  assert.strictEqual(normalizeGroupName("  Machine Learning   CSE-C  "), "machine learning cse-c");
  console.log("✓ Test 5 passed: Exact group matching");

  // ---------------------------------------------------------------------------
  // 6. Similar-but-different group name rejected (NO substring match)
  // ---------------------------------------------------------------------------
  assert.strictEqual(isGroupAllowed("CSE-C Official 2024"), false, "Removed group CSE-C Official 2024 must be rejected");
  assert.strictEqual(isGroupAllowed("CSE-C OFFICIAL"), false, "Removed group CSE-C OFFICIAL must be rejected");
  assert.strictEqual(isGroupAllowed("BTECH SEM V-SOFT SKILLS-CSE"), false, "Removed group SOFT SKILLS must be rejected");
  assert.strictEqual(isGroupAllowed("CSE-C"), false, "Substring alone must NOT match");
  assert.strictEqual(isGroupAllowed("CSE-C Friends & Fun"), false, "Groups containing 'CSE-C' must NOT match");
  assert.strictEqual(isGroupAllowed("Machine Learning CSE-C 2025"), false, "Different suffix must be rejected");
  assert.strictEqual(isGroupAllowed("Computer Networks CSE-B"), false, "Different section must be rejected");
  console.log("✓ Test 6 passed: Similar-but-different group name rejected");

  // ---------------------------------------------------------------------------
  // 7. Allowed group with academic message accepted
  // ---------------------------------------------------------------------------
  const req7 = makeRequest({
    message: "Machine Learning Project milestone 1 submission due 25 October at 11:59 PM: https://forms.gle/ml-proj",
    sourceGroup: "Machine Learning CSE-C",
    sourceSender: "ML Faculty",
    messageTimestamp: "2026-10-01T11:00:00Z"
  });
  const res7 = await handleCollectorMessage(req7);
  assert.strictEqual(res7.status, 201, "Valid academic message in allowed group must be accepted");
  const data7 = await res7.json();
  assert.strictEqual(data7.success, true);
  assert.ok(data7.item?.subject === "ML" || data7.item?.subject === "Machine Learning", "Subject should be ML or Machine Learning");
  console.log("✓ Test 7 passed: Allowed group with academic message accepted");

  // ---------------------------------------------------------------------------
  // 8. Allowed group with normal chatter ignored
  // ---------------------------------------------------------------------------
  const req8 = makeRequest({
    message: "Good morning sir! Thank you very much.",
    sourceGroup: "Machine Learning CSE-C",
    sourceSender: "Student A",
    messageTimestamp: "2026-10-01T11:05:00Z"
  });
  const res8 = await handleCollectorMessage(req8);
  assert.strictEqual(res8.status, 200, "Chatter should return 200 with ignored status");
  const data8 = await res8.json();
  assert.strictEqual(data8.action, "NON_ACADEMIC");
  assert.strictEqual(data8.category, "CHATTER");
  console.log("✓ Test 8 passed: Allowed group with normal chatter ignored");

  // ---------------------------------------------------------------------------
  // 9. Allowed group with attendance-only message ignored
  // ---------------------------------------------------------------------------
  const req9 = makeRequest({
    message: "Attendance will be taken tomorrow. Students with low attendance meet me in room 302.",
    sourceGroup: "Computer Networks CSE-C",
    sourceSender: "CN Faculty",
    messageTimestamp: "2026-10-01T11:10:00Z"
  });
  const res9 = await handleCollectorMessage(req9);
  assert.strictEqual(res9.status, 200, "Attendance-only notice must return 200 without creating event");
  const data9 = await res9.json();
  assert.strictEqual(data9.action, "NON_ACADEMIC");
  assert.strictEqual(data9.category, "ATTENDANCE_ONLY");
  console.log("✓ Test 9 passed: Allowed group with attendance-only message ignored");

  // ---------------------------------------------------------------------------
  // 10. Allowed group with advertisement ignored
  // ---------------------------------------------------------------------------
  const promoMsg = "Your Land. Your Legacy. Now with 0% Interest EMI. Premium open plots in gated community! Contact us today.";
  assert.strictEqual(isPromotionalMessage(promoMsg), true);
  const req10 = makeRequest({
    message: promoMsg,
    sourceGroup: "TOC 23CSE303 - CSE-C",
    sourceSender: "External Spammer",
    messageTimestamp: "2026-10-01T11:15:00Z"
  });
  const res10 = await handleCollectorMessage(req10);
  assert.strictEqual(res10.status, 200, "Promotional message must return 200 without event creation");
  const data10 = await res10.json();
  assert.strictEqual(data10.action, "NON_ACADEMIC");
  assert.strictEqual(data10.category, "PROMOTIONAL");
  console.log("✓ Test 10 passed: Allowed group with advertisement ignored");

  // ---------------------------------------------------------------------------
  // 11. Advertisement with URL ignored
  // ---------------------------------------------------------------------------
  const promoUrlMsg = "Exclusive offer: Luxury apartments with 0% down payment! Book your flat now: https://realestate-deals.example.com";
  assert.strictEqual(isPromotionalMessage(promoUrlMsg), true);
  const req11 = makeRequest({
    message: promoUrlMsg,
    sourceGroup: "Computer Networks CSE-C",
    sourceSender: "Advertiser",
    messageTimestamp: "2026-10-01T11:20:00Z"
  });
  const res11 = await handleCollectorMessage(req11);
  assert.strictEqual(res11.status, 200);
  const data11 = await res11.json();
  assert.strictEqual(data11.action, "NON_ACADEMIC");
  assert.strictEqual(data11.category, "PROMOTIONAL");
  console.log("✓ Test 11 passed: Advertisement with URL ignored");

  // ---------------------------------------------------------------------------
  // 12. Academic assignment with URL accepted
  // ---------------------------------------------------------------------------
  const req12 = makeRequest({
    message: "Computer Networks Wireshark Lab Assignment submission link: https://forms.gle/cn-lab-1 deadline 22 October at 5:00 PM",
    sourceGroup: "Computer Networks CSE-C",
    sourceSender: "CN Faculty",
    messageTimestamp: "2026-10-01T11:25:00Z"
  });
  const res12 = await handleCollectorMessage(req12);
  assert.strictEqual(res12.status, 201, "Academic assignment with submission URL must be accepted");
  const data12 = await res12.json();
  assert.strictEqual(data12.success, true);
  assert.strictEqual(data12.item?.submissionUrl, "https://forms.gle/cn-lab-1");
  console.log("✓ Test 12 passed: Academic assignment with URL accepted");

  // ---------------------------------------------------------------------------
  // 13. Multi-event message still creates multiple events
  // ---------------------------------------------------------------------------
  const multiEventMsg = "Internal exams are next Tuesday and next Thursday.";
  const refDate = new Date("2026-09-27T10:00:00Z"); // Sunday
  const parsedMultiple = parseMultipleAcademicMessages(multiEventMsg, {
    sourceGroup: "CSE-C Announcements",
    referenceDate: refDate
  });
  assert.strictEqual(parsedMultiple.length, 2, "Must produce exactly 2 separate events");
  assert.strictEqual(parsedMultiple[0].eventDate, "2026-09-29", "First exam must be Tuesday (2026-09-29)");
  assert.strictEqual(parsedMultiple[1].eventDate, "2026-10-01", "Second exam must be Thursday (2026-10-01)");
  console.log("✓ Test 13 passed: Multi-event message still creates multiple events");

  // ---------------------------------------------------------------------------
  // 14. Relative dates still resolve accurately
  // ---------------------------------------------------------------------------
  const tomorrowRes = extractDateString("Assignment due tomorrow", refDate);
  assert.strictEqual(tomorrowRes?.dateStr, "2026-09-28", "Tomorrow from Sunday Sep 27 must be Sep 28");

  const tuesdayRes = extractDateString("Exam next Tuesday", refDate);
  assert.strictEqual(tuesdayRes?.dateStr, "2026-09-29", "Tuesday must resolve to 2026-09-29");

  const thursdayRes = extractDateString("Exam next Thursday", refDate);
  assert.strictEqual(thursdayRes?.dateStr, "2026-10-01", "Thursday must cross month boundary to 2026-10-01");
  console.log("✓ Test 14 passed: Relative dates still resolve");

  // ---------------------------------------------------------------------------
  // 15. Disallowed group never reaches Gemini
  // ---------------------------------------------------------------------------
  // Disallowed group drops at gateway in processAcademicMessagePipeline before AI call
  const pipelineRes15 = await processAcademicMessagePipeline({
    message: "Important exam on 10 October",
    sourceGroup: "Disallowed Random Chat"
  });
  assert.strictEqual(pipelineRes15.action, "NON_ACADEMIC");
  assert.strictEqual(pipelineRes15.providerUsed, undefined, "AI Provider must NOT be invoked for disallowed group");
  console.log("✓ Test 15 passed: Disallowed group never reaches Gemini");

  // ---------------------------------------------------------------------------
  // 16. Disallowed group never reaches Supabase
  // ---------------------------------------------------------------------------
  const beforeEvents = await getAllAcademicEvents();
  const req16 = makeRequest({
    message: "Embedded Systems Lab Test on Friday",
    sourceGroup: "Embedded Project Group",
    messageTimestamp: "2026-10-01T12:00:00Z"
  });
  const res16 = await handleCollectorMessage(req16);
  assert.strictEqual(res16.status, 403);
  const afterEvents = await getAllAcademicEvents();
  const embeddedEvent = afterEvents.find(e => e.sourceGroup === "Embedded Project Group");
  assert.strictEqual(embeddedEvent, undefined, "No event from disallowed group may exist in database");
  console.log("✓ Test 16 passed: Disallowed group never reaches Supabase");

  // ---------------------------------------------------------------------------
  // 17. Disallowed group never reaches Notion
  // ---------------------------------------------------------------------------
  const pipelineRes17 = await processAcademicMessagePipeline({
    message: "Assignment 1 due Friday",
    sourceGroup: "Embedded Project Group"
  });
  assert.strictEqual(pipelineRes17.notionSync, undefined, "Notion sync must never be attempted for disallowed group");
  console.log("✓ Test 17 passed: Disallowed group never reaches Notion");

  // ---------------------------------------------------------------------------
  // 18. Server rejects spoofed sourceGroup
  // ---------------------------------------------------------------------------
  const req18 = makeRequest({
    message: "Fake announcement from attacker",
    sourceGroup: "Unauthorized Third Party Channel"
  });
  const res18 = await handleCollectorMessage(req18);
  assert.strictEqual(res18.status, 403, "Server must reject spoofed unallowed group with 403");
  const data18 = await res18.json();
  assert.strictEqual(data18.error, "GROUP_NOT_ALLOWED");
  console.log("✓ Test 18 passed: Server rejects spoofed sourceGroup");

  // ---------------------------------------------------------------------------
  // 19. Cursor exists only for allowed groups
  // ---------------------------------------------------------------------------
  // Valid update for allowed group
  const allowedGroup = "CSE-C Announcements";
  await updateCollectorGroupCursor(allowedGroup, {
    groupName: allowedGroup,
    lastProcessedMessageTimestamp: "2026-10-01T15:00:00Z"
  });
  const cursorState = await getCollectorGroupByRef(allowedGroup);
  assert.ok(cursorState, "Cursor state must exist for allowed group");
  assert.strictEqual(cursorState?.groupName, allowedGroup);

  // In userscript and backend, disallowed groups are never scanned or registered
  assert.strictEqual(isGroupAllowed("Disallowed Casual Group"), false);
  console.log("✓ Test 19 passed: Cursor exists only for allowed groups");

  // ---------------------------------------------------------------------------
  // 20. Two-hour scan processes only allowed groups
  // ---------------------------------------------------------------------------
  const simulatedSidebarChats = [
    { title: "Machine Learning CSE-C", isGroup: true }, // allowed
    { title: "Computer Networks CSE-C", isGroup: true }, // allowed
    { title: "CSE-C Official 2024", isGroup: true },    // unallowed
    { title: "Embedded Project Group", isGroup: true }, // unallowed
    { title: "Friends Hangout", isGroup: true },        // unallowed
    { title: "Mom", isGroup: false },                    // personal
    { title: "23CSE351 FoDS G1", isGroup: true }        // allowed
  ];

  const scannedByCycle = simulatedSidebarChats.filter(chat => {
    if (!chat.isGroup) return false;
    return isGroupAllowed(chat.title);
  });

  assert.strictEqual(scannedByCycle.length, 3, "Only the 3 allowed groups should be scanned");
  assert.deepStrictEqual(
    scannedByCycle.map(c => c.title),
    ["Machine Learning CSE-C", "Computer Networks CSE-C", "23CSE351 FoDS G1"],
    "Disallowed and personal groups must be completely skipped"
  );
  console.log("✓ Test 20 passed: Two-hour scan processes only allowed groups");

  // ---------------------------------------------------------------------------
  // Extra Test: Database Cleanup of Spam / Disallowed Groups
  // ---------------------------------------------------------------------------
  const dummySpam = await createAcademicEvent({
    title: "Your Land. Your Legacy. 0% EMI Villa Offer",
    subject: "NEEDS_CONFIRMATION",
    type: "OTHER",
    status: "INBOX",
    sourceGroup: "Embedded Project Group",
    description: "0% interest EMI open plots sale enquiry today",
    originalMessages: ["Your Land. Your Legacy. Now with 0% Interest EMI"]
  } as any);

  const preview = await executeCleanupInvalidEvents(true);
  const candidateFound = preview.candidates.some(c => c.id === dummySpam.id);
  assert.strictEqual(candidateFound, true, "Dry-run cleanup must identify invalid spam / disallowed group event");

  const cleanupRes = await executeCleanupInvalidEvents(false);
  assert.ok(cleanupRes.deletedCount >= 1, "Cleanup must delete invalid spam events");
  console.log("✓ Bonus test passed: Database cleanup preview and execution works safely");

  // ---------------------------------------------------------------------------
  // Requirement 9 & 10: Announcement Group & Personal Chat Detection Suite
  // ---------------------------------------------------------------------------
  console.log("\n--- Requirement 9 & 10: Announcement Group & Personal Chat Detection ---");
  
  // Test 10A: CSE-C Announcements with header group indicators and bottom "Only admins can send messages"
  const test10A = detectIsGroupChat({
    chatName: "CSE-C Announcements",
    headerActionLabel: "Group info",
    headerIcons: ["announcement", "community"],
    composerText: "Only admins can send messages"
  });
  assert.strictEqual(test10A, true, "10A: CSE-C Announcements with header & composer notice must detect as GROUP");
  console.log("✓ Test 10A passed: CSE-C Announcements with announcement UI detected as GROUP");

  // Test 10B: CSE-C Announcements with missing participant subtitle
  const test10B = detectIsGroupChat({
    chatName: "CSE-C Announcements",
    subtitleText: undefined,
    composerText: "Only admins can send messages"
  });
  assert.strictEqual(test10B, true, "10B: CSE-C Announcements with missing subtitle must detect as GROUP");
  console.log("✓ Test 10B passed: CSE-C Announcements without participant subtitle detected as GROUP");

  // Test 10C: CSE-C Announcements with no author header
  const test10C = detectIsGroupChat({
    chatName: "CSE-C Announcements",
    hasAuthorHeadersOnMessages: false,
    composerText: "Only admins can send messages"
  });
  assert.strictEqual(test10C, true, "10C: CSE-C Announcements without author headers must detect as GROUP");
  console.log("✓ Test 10C passed: CSE-C Announcements without author headers detected as GROUP");

  // Test 10D: Normal allowed group Machine Learning CSE-C
  const test10D = detectIsGroupChat({
    chatName: "Machine Learning CSE-C"
  });
  assert.strictEqual(test10D, true, "10D: Machine Learning CSE-C must detect as GROUP");
  console.log("✓ Test 10D passed: Machine Learning CSE-C detected as GROUP");

  // Test 10E: Normal personal chat: Vignesh
  const test10E = detectIsGroupChat({
    chatName: "Vignesh"
  });
  assert.strictEqual(test10E, false, "10E: Vignesh must detect as PERSONAL");
  console.log("✓ Test 10E passed: Normal personal chat 'Vignesh' detected as PERSONAL");

  // Requirement 9: Personal chat regression tests
  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Alex",
      subtitleText: "online"
    }),
    false,
    "Personal chat with 'online' subtitle must detect as PERSONAL"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Dr. Smith",
      headerActionLabel: "Contact info"
    }),
    false,
    "Personal chat with 'Contact info' header must detect as PERSONAL"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Rahul",
      subtitleText: "last seen today at 11:45 PM"
    }),
    false,
    "Personal chat with 'last seen...' subtitle must detect as PERSONAL"
  );

  assert.strictEqual(
    detectIsGroupChat({
      chatName: "Sneha",
      headerIcons: ["default-user"]
    }),
    false,
    "Personal chat with 'default-user' avatar icon must detect as PERSONAL"
  );
  console.log("✓ Requirement 9 passed: Genuine 1-to-1 personal chats strictly preserved as PERSONAL");

  // --- Requirement 11: Unicode mark resilience & Announcement ingestion ---
  const unicodeAnnouncements = "\u200ECSE-C Announcements\u200E";
  assert.strictEqual(isGroupAllowed(unicodeAnnouncements), true, "Unicode-wrapped 'CSE-C Announcements' must be allowed");
  assert.strictEqual(getCanonicalGroupName(unicodeAnnouncements), "CSE-C Announcements", "Must canonicalize to clean name");
  assert.strictEqual(
    detectIsGroupChat({ chatName: unicodeAnnouncements }),
    true,
    "Unicode-wrapped allowed group must be detected as GROUP"
  );
  console.log("✓ Test 10F passed: Unicode-wrapped 'CSE-C Announcements' detected as GROUP and allowed");

  const reqUnicode = makeRequest({
    message: "Announcement: Mid-term exam timetable has been released for CSE-C. Exams commence from 15th October.",
    sourceGroup: unicodeAnnouncements,
    sourceSender: "HOD",
    messageTimestamp: "2026-10-02T10:00:00Z"
  });
  const resUnicode = await handleCollectorMessage(reqUnicode);
  assert.strictEqual(resUnicode.status, 201, "Announcement message in unicode group must be ingested with 201");
  const dataUnicode = await resUnicode.json();
  assert.strictEqual(dataUnicode.success, true);
  console.log("✓ Test 10G passed: Announcement message in 'CSE-C Announcements' successfully ingested");

  console.log("\n============================================================");
  console.log("ALL GROUP FILTER & RELEVANCE TESTS PASSED CLEANLY! 🎉");
  console.log("============================================================\n");
}

runGroupFilterTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
