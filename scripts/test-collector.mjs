/**
 * Manual test script for Academic Command Center WhatsApp Collector endpoint
 * Tests POST /api/collector/messages with authentication, message ingestion,
 * event creation, postponement updates, ambiguous deadlines, and change history.
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const COLLECTOR_SECRET = process.env.COLLECTOR_SECRET || "change-me";

async function runCollectorManualTest() {
  console.log("============================================================");
  console.log("RUNNING WHATSAPP COLLECTOR MANUAL INTEGRATION TEST");
  console.log(`Target: ${BASE_URL}/api/collector/messages`);
  console.log("============================================================\n");

  const runTag = Date.now().toString().slice(-4);

  // Helper to dispatch message with collector secret
  async function sendCollectorMessage(payload, customAuth) {
    const authHeader = customAuth !== undefined ? customAuth : `Bearer ${COLLECTOR_SECRET}`;
    const headers = { "Content-Type": "application/json" };
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const res = await fetch(`${BASE_URL}/api/collector/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    return { status: res.status, data };
  }

  // ---------------------------------------------------------------------------
  // Step 1: Verify Authentication Security
  // ---------------------------------------------------------------------------
  console.log("Step 1: Testing Authentication Protection...");
  const noAuth = await sendCollectorMessage({ message: "Test", sourceGroup: "CSE" }, "");
  console.log(`  • Unauthenticated request: HTTP ${noAuth.status} (${noAuth.data.error})`);

  const badAuth = await sendCollectorMessage({ message: "Test", sourceGroup: "CSE" }, "Bearer wrong-secret");
  console.log(`  • Bad secret request: HTTP ${badAuth.status} (${badAuth.data.error})`);

  if (noAuth.status !== 401 || badAuth.status !== 403) {
    console.error("❌ Authentication security test failed!");
    process.exit(1);
  }
  console.log("  ✓ Authentication checks passed successfully!\n");

  // ---------------------------------------------------------------------------
  // Step 2: Test 1 - Assignment with Deadline & Submission Link
  // ---------------------------------------------------------------------------
  console.log("Step 2: Sending Assignment Message...");
  const msg1 = `OS Assignment 2 submission deadline is 12 October at 11:59 PM: https://forms.gle/test-${runTag}`;
  const res1 = await sendCollectorMessage({
    message: msg1,
    sourceGroup: "19CSE312 NLP Official",
    sourceSender: "OS Faculty Prof. Rao",
    messageTimestamp: new Date().toISOString(),
    sourceMessageId: `wamid.msg1_${runTag}`
  });

  console.log(`  • Response: HTTP ${res1.status}`);
  console.log(`  • Action: ${res1.data.action}`);
  console.log(`  • Event ID: ${res1.data.item?.id}`);
  console.log(`  • Title: ${res1.data.item?.title}`);
  console.log(`  • Submission URL: ${res1.data.item?.submissionUrl}`);
  console.log(`  • Notion Sync Status: ${res1.data.notionSync?.status}`);

  if (res1.data.action !== "CREATED" || !res1.data.item?.submissionUrl) {
    console.error("❌ Assignment creation test failed!");
    process.exit(1);
  }
  console.log("  ✓ Assignment created and recorded successfully!\n");

  // ---------------------------------------------------------------------------
  // Step 3: Test 2 - Initial Slip Test and Postponement Flow
  // ---------------------------------------------------------------------------
  console.log("Step 3: Testing Slip Test Postponement Flow...");
  const initialSlip = `Slip Test 2 on 30-09-2026 during 2nd period`;
  const slipRes1 = await sendCollectorMessage({
    message: initialSlip,
    sourceGroup: "19CSE312 NLP Official",
    sourceSender: "Faculty",
    messageTimestamp: new Date().toISOString(),
    sourceMessageId: `wamid.slip_init_${runTag}`
  });
  console.log(`  • Initial Event: ${slipRes1.data.item?.title} (Date: ${slipRes1.data.item?.eventDate})`);

  // Now send postponement message
  const postponementMsg = "Slip Test 2 has been postponed from 30 September to 3 October.";
  const slipRes2 = await sendCollectorMessage({
    message: postponementMsg,
    sourceGroup: "19CSE312 NLP Official",
    sourceSender: "Faculty",
    messageTimestamp: new Date().toISOString(),
    sourceMessageId: `wamid.slip_post_${runTag}`
  });

  console.log(`  • Postponement Response: HTTP ${slipRes2.status}`);
  console.log(`  • Action: ${slipRes2.data.action}`);
  console.log(`  • New Event Date: ${slipRes2.data.item?.eventDate}`);
  console.log(`  • New Status: ${slipRes2.data.item?.status}`);
  console.log(`  • Change History Records: ${slipRes2.data.item?.changeHistory?.length}`);
  console.log(`  • Change Summary: ${slipRes2.data.changeSummary}`);
  console.log(`  • Notion Sync: ${slipRes2.data.notionSync?.status}`);

  if (slipRes2.data.action !== "UPDATED" || slipRes2.data.item?.eventDate !== "2026-10-03") {
    console.error("❌ Postponement test failed!");
    process.exit(1);
  }
  console.log("  ✓ Slip test date updated in-place without duplicate!\n");

  // ---------------------------------------------------------------------------
  // Step 4: Test 3 - Ambiguous Deadline ("Submit this soon.")
  // ---------------------------------------------------------------------------
  console.log("Step 4: Testing Ambiguous Message ('Please submit this soon.')...");
  const ambMsg = `Please submit project ${runTag} soon.`;
  const ambRes = await sendCollectorMessage({
    message: ambMsg,
    sourceGroup: "19CSE312 NLP Official",
    sourceSender: "Rep",
    messageTimestamp: new Date().toISOString(),
    sourceMessageId: `wamid.amb_${runTag}`
  });

  console.log(`  • Ambiguous Response: HTTP ${ambRes.status}`);
  console.log(`  • Action: ${ambRes.data.action}`);
  console.log(`  • Needs Confirmation: ${ambRes.data.item?.needsConfirmation}`);
  console.log(`  • Deadline: ${ambRes.data.item?.deadline || "None (Correctly not hallucinated)"}`);

  if (!ambRes.data.item?.needsConfirmation) {
    console.error("❌ Ambiguous deadline test failed!");
    process.exit(1);
  }
  console.log("  ✓ Ambiguous message flagged with needsConfirmation=true!\n");

  // ---------------------------------------------------------------------------
  // Step 5: Test 4 - Duplicate Message Protection
  // ---------------------------------------------------------------------------
  console.log("Step 5: Testing Duplicate Protection...");
  const dupRes = await sendCollectorMessage({
    message: msg1,
    sourceGroup: "19CSE312 NLP Official",
    sourceSender: "OS Faculty Prof. Rao"
  });

  console.log(`  • Duplicate Action: ${dupRes.data.action}`);
  console.log(`  • Reason: ${dupRes.data.reason}`);

  if (dupRes.data.action !== "IGNORED_DUPLICATE") {
    console.error("❌ Duplicate message test failed!");
    process.exit(1);
  }
  console.log("  ✓ Exact message detected and deduplicated!\n");

  // ---------------------------------------------------------------------------
  // Step 6: Test 5 - Query Collector Status Endpoint
  // ---------------------------------------------------------------------------
  console.log("Step 6: Querying GET /api/collector/status...");
  const statusRes = await fetch(`${BASE_URL}/api/collector/status`);
  const statusData = await statusRes.json();
  console.log("  • Collector Stats:", JSON.stringify(statusData.stats, null, 2));

  console.log("\n============================================================");
  console.log("ALL MANUAL COLLECTOR VERIFICATIONS COMPLETED SUCCESSFULLY! 🎉");
  console.log("============================================================\n");
}

runCollectorManualTest().catch(err => {
  console.error("Collector test error:", err);
  process.exit(1);
});
