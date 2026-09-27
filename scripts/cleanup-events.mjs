/**
 * Academic Command Center - Safe Event Cleanup CLI Script
 * 
 * Usage:
 *   node scripts/cleanup-events.mjs           # Preview invalid events (dry run)
 *   node scripts/cleanup-events.mjs --apply   # Safely delete invalid events
 */

import { executeCleanupInvalidEvents } from "../src/lib/db/cleanup.ts";

const isApply = process.argv.includes("--apply");
const dryRun = !isApply;

console.log("=================================================");
console.log(`Academic Command Center - Event Cleanup (${dryRun ? "DRY RUN PREVIEW" : "APPLYING DELETION"})`);
console.log("=================================================");

try {
  const result = await executeCleanupInvalidEvents(dryRun);
  console.log(`• Total Events Scanned: ${result.totalScanned}`);
  console.log(`• Invalid Events Found: ${result.candidatesCount}`);

  if (result.candidates.length > 0) {
    console.log("\nIdentified Candidates for Removal:");
    result.candidates.forEach((c, idx) => {
      console.log(`  [${idx + 1}] ID: ${c.id}`);
      console.log(`      Title: "${c.title}"`);
      console.log(`      Subject: ${c.subject}`);
      console.log(`      Group: ${c.sourceGroup || "None"}`);
      console.log(`      Reason: ${c.reason} - ${c.detail}`);
    });

    if (dryRun) {
      console.log("\nNOTE: This was a dry run. No events were deleted.");
      console.log("To permanently delete these events, run with --apply:");
      console.log("  node scripts/cleanup-events.mjs --apply");
    } else {
      console.log(`\nSuccessfully deleted ${result.deletedCount} invalid events.`);
    }
  } else {
    console.log("\nNo invalid events found! All academic events are clean.");
  }
} catch (err) {
  console.error("Cleanup error:", err);
  process.exit(1);
}
