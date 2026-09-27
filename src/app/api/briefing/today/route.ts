import { NextResponse } from "next/server";
import { generateMorningBriefing } from "@/lib/reminders/reminderEngine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const briefing = await generateMorningBriefing(new Date(), "Asia/Kolkata");
    return NextResponse.json({
      success: true,
      briefing
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to generate morning briefing.", details: err.message },
      { status: 500 }
    );
  }
}
