import { NextResponse } from "next/server";
import { executeCleanupInvalidEvents, identifyInvalidAcademicEvents } from "@/lib/db/cleanup";

/**
 * GET /api/events/cleanup
 * Previews all invalid events that meet cleanup criteria (dry-run).
 * Never mutates the database on GET.
 */
export async function GET() {
  try {
    const preview = await executeCleanupInvalidEvents(true);
    return NextResponse.json({
      success: true,
      dryRun: true,
      preview
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to preview cleanup candidates." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/events/cleanup
 * Executes safe removal of identified invalid events.
 * Accepts optional body: { dryRun: boolean } (defaults to false).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = Boolean(body.dryRun);

    const result = await executeCleanupInvalidEvents(dryRun);
    return NextResponse.json({
      success: true,
      result
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to execute cleanup." },
      { status: 500 }
    );
  }
}
