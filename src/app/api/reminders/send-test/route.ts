import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatchNotification } from "@/lib/reminders/notificationProvider";
import { ReminderNotification } from "@/lib/reminders/reminderTypes";

const sendTestSchema = z.object({
  title: z.string().optional(),
  message: z.string().optional(),
  priority: z.enum(["URGENT", "HIGH", "REVIEW", "NORMAL"]).optional(),
  submissionUrl: z.string().url().optional()
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parseResult = sendTestSchema.safeParse(body);
    const data = parseResult.success ? parseResult.data : {};

    const notification: ReminderNotification = {
      id: `test-${Date.now()}`,
      title: data.title || "Academic Command Center: Reminder Test",
      body: data.message || "DBMS Assignment 3 is due tomorrow at 11:59 PM.",
      channel: "CONSOLE",
      priority: data.priority || "HIGH",
      submissionUrl: data.submissionUrl || "https://forms.gle/test-demo",
      scheduledFor: new Date().toISOString()
    };

    const result = await dispatchNotification(notification);
    return NextResponse.json({
      success: result.success,
      notification,
      delivery: result
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to dispatch test notification.", details: err.message },
      { status: 500 }
    );
  }
}
