/**
 * Manual and Integration verification script for Phase 4B: Automated Reminders & Morning Briefing
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function runReminderIntegrationSuite() {
  console.log("============================================================");
  console.log("RUNNING PHASE 4B REMINDERS INTEGRATION TEST SUITE");
  console.log(`Target: ${BASE_URL}/api`);
  console.log("============================================================\n");

  // 1. Settings GET
  console.log("Step 1: Fetching Reminder Settings (GET /api/reminders/settings)...");
  const resSettings = await fetch(`${BASE_URL}/api/reminders/settings`);
  const dataSettings = await resSettings.json();
  console.log(`  • Status: HTTP ${resSettings.status}`);
  console.log(`  • Enabled: ${dataSettings.settings?.enabled}`);
  console.log(`  • Briefing Time: ${dataSettings.settings?.morning_briefing_time}`);
  console.log(`  • Timezone: ${dataSettings.settings?.timezone}`);
  if (!dataSettings.success || !dataSettings.settings) {
    throw new Error("Failed to fetch reminder settings.");
  }
  console.log("  ✓ Settings retrieved successfully!\n");

  // 2. Settings PATCH
  console.log("Step 2: Updating Reminder Settings (PATCH /api/reminders/settings)...");
  const resPatch = await fetch(`${BASE_URL}/api/reminders/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      morning_briefing_time: "07:30",
      deadline_reminders_enabled: true
    })
  });
  const dataPatch = await resPatch.json();
  console.log(`  • Status: HTTP ${resPatch.status}`);
  console.log(`  • Updated Briefing Time: ${dataPatch.settings?.morning_briefing_time}`);
  if (!dataPatch.success) {
    throw new Error("Failed to patch reminder settings.");
  }
  console.log("  ✓ Settings patched successfully!\n");

  // 3. Generate Reminders
  console.log("Step 3: Triggering Reminder Calculation (POST /api/reminders/generate)...");
  const resGen = await fetch(`${BASE_URL}/api/reminders/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referenceDate: "2026-09-26T10:00:00+05:30" })
  });
  const dataGen = await resGen.json();
  console.log(`  • Status: HTTP ${resGen.status}`);
  console.log(`  • Scanned Events: ${dataGen.result?.scannedEvents}`);
  console.log(`  • Reminders Created: ${dataGen.result?.remindersCreated}`);
  console.log(`  • Reminders Cancelled: ${dataGen.result?.remindersCancelled}`);
  console.log(`  • Active Reminders Count: ${dataGen.result?.activeRemindersCount}`);
  if (!dataGen.success) {
    throw new Error("Failed to generate reminders.");
  }
  console.log("  ✓ Reminders calculated successfully!\n");

  // 4. List Reminders
  console.log("Step 4: Listing Reminders (GET /api/reminders)...");
  const resList = await fetch(`${BASE_URL}/api/reminders`);
  const dataList = await resList.json();
  console.log(`  • Status: HTTP ${resList.status}`);
  console.log(`  • Total Reminders: ${dataList.count}`);
  console.log(`  • Next Reminder: ${dataList.scheduler?.nextReminderTimestamp || "None"}`);
  console.log(`  • Next Briefing: ${dataList.scheduler?.nextMorningBriefingTimestamp || "None"}`);
  if (!dataList.success || !Array.isArray(dataList.reminders)) {
    throw new Error("Failed to retrieve reminders list.");
  }
  console.log("  ✓ Reminders retrieved successfully!\n");

  // 5. Morning Briefing Preview
  console.log("Step 5: Previewing Morning Briefing (GET /api/briefing/preview)...");
  const resBriefing = await fetch(`${BASE_URL}/api/briefing/preview?date=2026-09-26T10:00:00%2B05:30`);
  const dataBriefing = await resBriefing.json();
  console.log(`  • Status: HTTP ${resBriefing.status}`);
  console.log(`  • Summary: ${dataBriefing.briefing?.summary}`);
  console.log(`  • Today items: ${dataBriefing.briefing?.today?.length}`);
  console.log(`  • Tomorrow items: ${dataBriefing.briefing?.tomorrow?.length}`);
  console.log(`  • Upcoming items: ${dataBriefing.briefing?.upcoming?.length}`);
  console.log(`  • Overdue items: ${dataBriefing.briefing?.overdue?.length}`);
  if (!dataBriefing.success || !dataBriefing.briefing) {
    throw new Error("Failed to preview morning briefing.");
  }
  console.log("  ✓ Morning briefing previewed successfully!\n");

  // 6. Test Reminder Dispatch
  console.log("Step 6: Sending Test Reminder (POST /api/reminders/send-test)...");
  const resTest = await fetch(`${BASE_URL}/api/reminders/send-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "DBMS Assignment 3",
      message: "DBMS Assignment 3 is due tomorrow at 11:59 PM.",
      priority: "HIGH",
      submissionUrl: "https://forms.gle/demo-submission"
    })
  });
  const dataTest = await resTest.json();
  console.log(`  • Status: HTTP ${resTest.status}`);
  console.log(`  • Delivery Channel: ${dataTest.delivery?.channel}`);
  console.log(`  • Delivered At: ${dataTest.delivery?.deliveredAt}`);
  if (!dataTest.success) {
    throw new Error("Failed to dispatch test notification.");
  }
  console.log("  ✓ Test reminder dispatched successfully!\n");

  console.log("============================================================");
  console.log("ALL PHASE 4B API ENDPOINTS VERIFIED SUCCESSFULLY! 🎉");
  console.log("============================================================\n");
}

runReminderIntegrationSuite().catch(err => {
  console.error("❌ Integration suite failed:", err.message);
  process.exit(1);
});
