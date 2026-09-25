import { NextResponse } from "next/server";
import { processAcademicMessagePipeline } from "@/lib/messages/processor";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const rawMessage = typeof body?.message === "string"
      ? body.message.trim()
      : typeof body?.text === "string"
        ? body.text.trim()
        : "";

    const sourceGroup = typeof body?.sourceGroup === "string" ? body.sourceGroup.trim() : undefined;
    const sourceSender = typeof body?.sourceSender === "string" ? body.sourceSender.trim() : undefined;
    const messageTimestamp = typeof body?.messageTimestamp === "string" ? body.messageTimestamp.trim() : undefined;
    const sourceMessageId = typeof body?.sourceMessageId === "string" ? body.sourceMessageId.trim() : undefined;

    if (!rawMessage) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }

    const result = await processAcademicMessagePipeline({
      message: rawMessage,
      source: "api",
      sourceGroup,
      sourceSender,
      messageTimestamp,
      sourceMessageId
    });

    const status = result.action === "CREATED" ? 201 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    console.error("POST /api/messages/process error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process message." },
      { status: 500 }
    );
  }
}
