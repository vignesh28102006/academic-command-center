import { NextResponse } from "next/server";
import { processAcademicMessageWithAI } from "@/lib/events";
import { AcademicItem } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  // Accept either "message" or "text" for compatibility
  const rawMessage = typeof body?.message === "string"
    ? body.message.trim()
    : typeof body?.text === "string"
      ? body.text.trim()
      : "";

  const existingItems: AcademicItem[] = Array.isArray(body?.existingItems) ? body.existingItems : [];
  const sourceGroup = typeof body?.sourceGroup === "string" ? body.sourceGroup.trim() : undefined;
  const sourceSender = typeof body?.sourceSender === "string" ? body.sourceSender.trim() : undefined;

  if (!rawMessage) {
    return NextResponse.json({ error: "Message text is required." }, { status: 400 });
  }

  try {
    const result = await processAcademicMessageWithAI(
      rawMessage,
      existingItems,
      {
        sourceGroup,
        sourceSender,
        timezone: "Asia/Kolkata"
      }
    );

    return NextResponse.json({
      result: {
        action: result.action,
        item: result.item,
        updatedItemId: result.updatedItemId,
        changeSummary: result.changeSummary,
        reason: result.reason,
        confidence: result.confidence
      },
      aiExtraction: result.aiExtraction ?? null,
      validation: {
        valid: true,
        confidenceScore: result.aiExtraction?.confidence ?? null,
        confidenceLevel: result.confidence ?? "MEDIUM",
        needsConfirmation: result.aiExtraction?.needsConfirmation ?? false,
        confirmationReason: result.aiExtraction?.confirmationReason ?? null
      },
      providerUsed: result.providerUsed ?? "deterministic-fallback",
      fallbackOccurred: result.fallbackOccurred ?? false,
      beforeAfter: result.beforeAfter ?? null
    });
  } catch (err) {
    console.error("Parse route error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to process academic message."
      },
      { status: 500 }
    );
  }
}