import { NextResponse } from "next/server";
import { getAllReminders } from "@/lib/db/reminders";
import { getAllAcademicEvents } from "@/lib/db/academicEvents";
import { getSchedulerStatus } from "@/lib/reminders/reminderScheduler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "ALL";
    const eventId = searchParams.get("eventId") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;

    const [reminders, events, schedulerStatus] = await Promise.all([
      getAllReminders({ status: status === "ALL" ? undefined : status, eventId, limit }),
      getAllAcademicEvents(),
      getSchedulerStatus()
    ]);

    // Attach event metadata for convenient display
    const eventMap = new Map(events.map(e => [e.id, e]));
    const enrichedReminders = reminders.map(r => {
      const ev = eventMap.get(r.eventId);
      return {
        ...r,
        eventTitle: ev?.title || r.eventTitle || "Academic Event",
        eventSubject: ev?.subject || r.eventSubject || "General",
        eventType: ev?.type || r.eventType || "OTHER",
        submissionUrl: ev?.submissionUrl || r.submissionUrl
      };
    });

    return NextResponse.json({
      success: true,
      scheduler: schedulerStatus,
      count: enrichedReminders.length,
      reminders: enrichedReminders
    });
  } catch (err: any) {
    console.error("GET /api/reminders error:", err);
    return NextResponse.json(
      { error: "Failed to retrieve reminders.", details: err.message },
      { status: 500 }
    );
  }
}
