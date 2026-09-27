import { NextResponse } from "next/server";
import { z } from "zod";
import { getReminderSettings, updateReminderSettings } from "@/lib/db/reminders";

const settingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  morning_briefing_enabled: z.boolean().optional(),
  morning_briefing_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be HH:MM format (24h)").optional(),
  timezone: z.string().min(1).optional(),
  deadline_reminders_enabled: z.boolean().optional(),
  exam_reminders_enabled: z.boolean().optional(),
  default_reminder_intervals: z.array(z.string()).min(1).optional()
});

export async function GET() {
  try {
    const settings = await getReminderSettings();
    return NextResponse.json({
      success: true,
      settings
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to fetch reminder settings.", details: err.message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const parseResult = settingsPatchSchema.safeParse(body);
    if (!parseResult.success) {
      const details = parseResult.error.issues.map(e => `${e.path.join(".")}: ${e.message}`);
      return NextResponse.json(
        { error: "Validation failed.", details },
        { status: 400 }
      );
    }

    const updated = await updateReminderSettings(parseResult.data);
    return NextResponse.json({
      success: true,
      settings: updated
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to update reminder settings.", details: err.message },
      { status: 500 }
    );
  }
}
