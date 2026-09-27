import { NextResponse } from "next/server";
import { generateMorningBriefing } from "@/lib/reminders/reminderEngine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const targetDate = dateParam ? new Date(dateParam) : new Date();

    if (isNaN(targetDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid date parameter. Expected ISO or YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    const briefing = await generateMorningBriefing(targetDate, "Asia/Kolkata");
    return NextResponse.json({
      success: true,
      briefing
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to preview morning briefing.", details: err.message },
      { status: 500 }
    );
  }
}
