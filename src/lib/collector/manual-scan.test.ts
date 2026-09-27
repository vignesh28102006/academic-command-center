import assert from "node:assert";
import { executeManualGroupScan, getBadgeDisplayText, RawScanMessage, ManualScanStats } from "./manual-scan";

async function runTests() {
  console.log("=== RUNNING TAMPERMONKEY COLLECTOR FLOATING BADGE UX TESTS ===");

  const allowedGroup1 = "CSE-C Announcements";
  const allowedGroup2 = "NLP 2026 batch";
  const unallowedGroup = "Embedded Systems Project 2026";

  // Test 1: Allowed group -> SCANNING
  {
    console.log("Test 1: Allowed group -> SCANNING");
    const progressUpdates: ManualScanStats[] = [];

    await executeManualGroupScan({
      groupName: allowedGroup1,
      messages: [
        {
          id: "m1",
          text: "Assignment 1 submission due 28 September at 5 PM.",
          timestamp: "2026-09-12T10:00:00+05:30"
        }
      ],
      sendMessage: async () => ({ action: "CREATED" }),
      updateCursor: async () => {},
      onProgress: (s) => {
        progressUpdates.push({ ...s });
      }
    });

    const scanningUpdate = progressUpdates.find(s => s.scanStatus === "SCANNING");
    assert.ok(scanningUpdate, "Expected SCANNING status update");
    assert.strictEqual(scanningUpdate.scanStatus, "SCANNING");
    const badgeText = getBadgeDisplayText(scanningUpdate);
    assert.ok(badgeText.includes("🟡 ACC Collector: Scanning · CSE-C Announcements"), `Expected badge to include Scanning · CSE-C Announcements, got: ${badgeText}`);
    console.log("✓ Test 1 passed: Allowed group transitions to SCANNING with yellow badge");
  }

  // Test 2: Successful scan -> COMPLETE
  {
    console.log("Test 2: Successful scan -> COMPLETE");
    const stats = await executeManualGroupScan({
      groupName: allowedGroup1,
      messages: [
        {
          id: "m1",
          text: "Machine Learning Assignment 1 due 29 September.",
          timestamp: "2026-09-12T10:00:00+05:30"
        }
      ],
      sendMessage: async () => ({ action: "CREATED" }),
      updateCursor: async () => {}
    });

    assert.strictEqual(stats.scanStatus, "COMPLETE");
    const badgeText = getBadgeDisplayText(stats);
    assert.strictEqual(badgeText, "🟢 ACC Collector: Scan Complete · CSE-C Announcements · 1 processed");
    console.log("✓ Test 2 passed: Successful scan transitions to COMPLETE with green badge");
  }

  // Test 3: Failed scan -> ERROR
  {
    console.log("Test 3: Failed scan -> ERROR");
    let recordedCursor: any = null;

    const stats = await executeManualGroupScan({
      groupName: allowedGroup1,
      messages: [
        {
          id: "m_ok",
          text: "Lab 1 submission link is live.",
          timestamp: "2026-09-12T10:00:00+05:30"
        },
        {
          id: "m_fail",
          text: "Lab 2 exam scheduled for tomorrow.",
          timestamp: "2026-09-14T10:00:00+05:30"
        }
      ],
      sendMessage: async (p) => {
        if (p.sourceMessageId === "m_fail") {
          throw new Error("Supabase write failure: timeout");
        }
        return { action: "CREATED" };
      },
      updateCursor: async (p) => {
        recordedCursor = p;
      }
    });

    assert.strictEqual(stats.scanStatus, "ERROR");
    assert.strictEqual(stats.academicMessages, 1, "Only successfully processed message counted");
    assert.strictEqual(stats.failedMessageCount, 1);
    assert.strictEqual(stats.errorReason, "Supabase write failure: timeout");
    const badgeText = getBadgeDisplayText(stats);
    assert.strictEqual(badgeText, "🔴 ACC Collector: Scan Error · CSE-C Announcements");
    // Cursor must not advance past failed message
    assert.strictEqual(recordedCursor?.status, "ERROR");
    assert.strictEqual(recordedCursor?.lastProcessedMessageTimestamp, "2026-09-12T10:00:00+05:30");
    console.log("✓ Test 3 passed: Failed scan transitions to ERROR with red badge & cursor held");
  }

  // Test 4: Personal chat -> PERSONAL_IGNORED
  {
    console.log("Test 4: Personal chat -> PERSONAL_IGNORED");
    let sendCalled = false;
    let cursorCalled = false;

    const stats = await executeManualGroupScan({
      groupName: "John Doe",
      isPersonalChat: true,
      messages: [
        {
          id: "p1",
          text: "Hey, can you send the assignment?",
          timestamp: "2026-09-12T10:00:00+05:30"
        }
      ],
      sendMessage: async () => {
        sendCalled = true;
        return { action: "CREATED" };
      },
      updateCursor: async () => {
        cursorCalled = true;
      }
    });

    assert.strictEqual(stats.scanStatus, "PERSONAL_IGNORED");
    assert.strictEqual(sendCalled, false, "Must never send personal messages to backend");
    assert.strictEqual(cursorCalled, false, "Must never update cursor for personal chat");
    const badgeText = getBadgeDisplayText(stats);
    assert.strictEqual(badgeText, "⚪ ACC Collector: Personal Chat Ignored");
    console.log("✓ Test 4 passed: Personal chat transitions to PERSONAL_IGNORED with white badge");
  }

  // Test 5: Unallowed group -> GROUP_NOT_MONITORED
  {
    console.log("Test 5: Unallowed group -> GROUP_NOT_MONITORED");
    let sendCalled = false;
    let cursorCalled = false;

    const stats = await executeManualGroupScan({
      groupName: unallowedGroup,
      messages: [
        {
          id: "u1",
          text: "Embedded Systems project submission is due Friday.",
          timestamp: "2026-09-12T10:00:00+05:30"
        }
      ],
      sendMessage: async () => {
        sendCalled = true;
        return { action: "CREATED" };
      },
      updateCursor: async () => {
        cursorCalled = true;
      }
    });

    assert.strictEqual(stats.scanStatus, "GROUP_NOT_MONITORED");
    assert.strictEqual(sendCalled, false, "Must never send unallowed group messages to backend");
    assert.strictEqual(cursorCalled, false, "Must never create or update cursor for unallowed group");
    const badgeText = getBadgeDisplayText(stats);
    assert.strictEqual(badgeText, "⚪ ACC Collector: Group Not Monitored");
    console.log("✓ Test 5 passed: Unallowed group transitions to GROUP_NOT_MONITORED with white badge");
  }

  // Test 6: Backend unavailable -> WHATSAPP_UNAVAILABLE
  {
    console.log("Test 6: Backend unavailable -> WHATSAPP_UNAVAILABLE");
    let sendCalled = false;

    const stats = await executeManualGroupScan({
      groupName: allowedGroup1,
      isWhatsAppAvailable: false,
      messages: [],
      sendMessage: async () => {
        sendCalled = true;
        return { action: "CREATED" };
      }
    });

    assert.strictEqual(stats.scanStatus, "WHATSAPP_UNAVAILABLE");
    assert.strictEqual(sendCalled, false);
    const badgeText = getBadgeDisplayText(stats);
    assert.strictEqual(badgeText, "🔴 ACC Collector: WhatsApp Unavailable");
    console.log("✓ Test 6 passed: Backend/WhatsApp unavailable transitions to WHATSAPP_UNAVAILABLE");
  }

  // Test 7: Group switch resets state
  {
    console.log("Test 7: Group switch resets state");
    // Group 1 completes
    const group1Stats = await executeManualGroupScan({
      groupName: allowedGroup1,
      messages: [
        {
          id: "g1_1",
          text: "CSE-C Announcement: internal test on 3 October.",
          timestamp: "2026-09-12T10:00:00+05:30"
        }
      ],
      sendMessage: async () => ({ action: "CREATED" }),
      updateCursor: async () => {}
    });

    assert.strictEqual(group1Stats.scanStatus, "COMPLETE");
    assert.strictEqual(group1Stats.academicMessages, 1);

    // User switches to Group 2: New scan begins from fresh initial state
    const group2Updates: ManualScanStats[] = [];

    const group2Stats = await executeManualGroupScan({
      groupName: allowedGroup2,
      messages: [
        {
          id: "g2_1",
          text: "NLP 2026 quiz on Wednesday.",
          timestamp: "2026-09-15T10:00:00+05:30"
        }
      ],
      sendMessage: async () => ({ action: "CREATED" }),
      updateCursor: async () => {},
      onProgress: (s) => {
        group2Updates.push({ ...s });
      }
    });

    const g2Scanning = group2Updates.find(s => s.scanStatus === "SCANNING");
    assert.ok(g2Scanning, "Switching groups must immediately start in SCANNING state");
    assert.strictEqual(g2Scanning.academicMessages, 0, "Counter must reset to 0 for the new group");
    assert.strictEqual(group2Stats.groupName, allowedGroup2);
    assert.strictEqual(group2Stats.scanStatus, "COMPLETE");
    assert.strictEqual(getBadgeDisplayText(group2Stats), "🟢 ACC Collector: Scan Complete · NLP 2026 batch · 1 processed");
    console.log("✓ Test 7 passed: Group switch resets state and does not carry over completion");
  }

  // Test 8: Completion counter shows current scan only
  {
    console.log("Test 8: Completion counter shows current scan only");
    const messages: RawScanMessage[] = [
      {
        id: "c1",
        text: "Old announcement before boundary",
        timestamp: "2026-08-15T10:00:00+05:30" // Ignored before Sept 10
      },
      {
        id: "c2",
        text: "Good morning sir 🙏",
        timestamp: "2026-09-12T09:00:00+05:30" // Chatter ignored
      },
      {
        id: "c3",
        text: "Special offer: Plots for sale with 0% EMI!",
        timestamp: "2026-09-12T10:00:00+05:30" // Promo ignored
      },
      {
        id: "c4",
        text: "Academic Assignment 1 due 30 September.",
        timestamp: "2026-09-12T11:00:00+05:30" // Academic processed
      },
      {
        id: "c4", // Duplicate
        text: "Academic Assignment 1 due 30 September.",
        timestamp: "2026-09-12T11:00:00+05:30"
      }
    ];

    const stats = await executeManualGroupScan({
      groupName: allowedGroup1,
      messages,
      sendMessage: async () => ({ action: "CREATED" }),
      updateCursor: async () => {}
    });

    assert.strictEqual(stats.messagesScanned, 5);
    assert.strictEqual(stats.messagesIgnored, 3); // 1 old boundary + 1 chatter + 1 promo
    assert.strictEqual(stats.duplicates, 1);
    assert.strictEqual(stats.academicMessages, 1, "Rocket counter must only count the 1 legitimately processed message");
    console.log("✓ Test 8 passed: Completion counter shows current scan only");
  }

  // Test 9: Cursor saved before COMPLETE
  {
    console.log("Test 9: Cursor saved before COMPLETE");
    let cursorSavedAt = 0;
    let completeMarkedAt = 0;

    await executeManualGroupScan({
      groupName: allowedGroup1,
      messages: [
        {
          id: "m_time",
          text: "End sem project deadline extended to 10 October.",
          timestamp: "2026-09-16T12:00:00+05:30"
        }
      ],
      sendMessage: async () => {
        await new Promise(r => setTimeout(r, 10));
        return { action: "UPDATED" };
      },
      updateCursor: async () => {
        await new Promise(r => setTimeout(r, 15));
        cursorSavedAt = Date.now();
      },
      onProgress: (s) => {
        if (s.scanStatus === "COMPLETE") {
          completeMarkedAt = Date.now();
        }
      }
    });

    assert.ok(cursorSavedAt > 0, "Cursor must have been saved");
    assert.ok(completeMarkedAt > 0, "Scan must have completed");
    assert.ok(cursorSavedAt <= completeMarkedAt, `Cursor update (${cursorSavedAt}) must precede COMPLETE state (${completeMarkedAt})`);
    console.log("✓ Test 9 passed: Cursor saved before COMPLETE state");
  }

  // Test 10: COMPLETE not shown before backend/Notion processing finishes
  {
    console.log("Test 10: COMPLETE not shown before backend/Notion processing finishes");
    let backendProcessingFinished = false;
    const prematureCompleteUpdates: string[] = [];

    await executeManualGroupScan({
      groupName: allowedGroup1,
      messages: [
        {
          id: "m_async",
          text: "Assignment 2 submission link is uploaded on Google Classroom.",
          timestamp: "2026-09-17T14:00:00+05:30"
        }
      ],
      sendMessage: async () => {
        // Simulate async Supabase write + Notion sync
        await new Promise(r => setTimeout(r, 25));
        backendProcessingFinished = true;
        return { action: "CREATED" };
      },
      updateCursor: async () => {},
      onProgress: (s) => {
        if (!backendProcessingFinished && s.scanStatus === "COMPLETE") {
          prematureCompleteUpdates.push(s.scanStatus);
        }
      }
    });

    assert.strictEqual(prematureCompleteUpdates.length, 0, "COMPLETE must NEVER be shown while backend processing is pending");
    assert.strictEqual(backendProcessingFinished, true);
    console.log("✓ Test 10 passed: COMPLETE not shown before backend/Notion processing finishes");
  }

  console.log("\nALL 10 TAMPERMONKEY COLLECTOR FLOATING BADGE UX TESTS PASSED SUCCESSFULLY! ✓✓✓\n");
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
