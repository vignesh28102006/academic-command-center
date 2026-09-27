import { NextResponse } from "next/server";
import { z } from "zod";
import { generateReminders } from "@/lib/reminders/reminderEngine";

const generateSchema = z.object({
  referenceDate: z.string().optional(),
  dispatchDue: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parseResult = generateSchema.safeParse(body);
    const { referenceDate, dispatchDue } = parseResult.success ? parseResult.data : {};

    const ref = referenceDate ? new Date(referenceDate) : new Date();
    const shouldDispatch = dispatchDue !== undefined ? dispatchDue : true;

    const result = await generateReminders(ref, shouldDispatch);
    return NextResponse.json({
      success: true,
      result
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to generate reminders.", details: err.message },
      { status: 500 }
    );
  }
}
