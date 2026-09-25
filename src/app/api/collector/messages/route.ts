import { NextResponse } from "next/server";
import { z } from "zod";
import { processAcademicMessagePipeline } from "@/lib/messages/processor";
import { recordCollectorMetric, getCollectorStats } from "@/lib/collector/stats";
import { isMessageEligibleForBackfill } from "@/lib/dateUtils";
import { updateCollectorGroupCursor } from "@/lib/db/collectorState";

const collectorMessageSchema = z.object({
  message: z.string().min(1, "message cannot be empty"),
  sourceGroup: z.string().min(1, "sourceGroup cannot be empty"),
  sourceSender: z.string().optional(),
  messageTimestamp: z.string().optional(),
  sourceMessageId: z.string().optional()
});

export async function POST(request: Request) {
  try {
    // 1. Verify Authorization Header
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Missing or malformed Authorization header. Expected 'Bearer <COLLECTOR_SECRET>'." },
        { status: 401 }
      );
    }

    const providedSecret = authHeader.slice(7).trim();
    const serverSecret = process.env.COLLECTOR_SECRET;

    if (!serverSecret) {
      console.warn("COLLECTOR_SECRET is not configured on the server.");
      return NextResponse.json(
        { error: "Server collector authentication is not configured." },
        { status: 503 }
      );
    }

    if (providedSecret !== serverSecret) {
      return NextResponse.json(
        { error: "Invalid collector secret." },
        { status: 403 }
      );
    }

    // 2. Validate Request Body with Zod
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const parseResult = collectorMessageSchema.safeParse(body);
    if (!parseResult.success) {
      const details = (parseResult.error.issues || []).map(e => `${e.path.join(".")}: ${e.message}`);
      return NextResponse.json(
        {
          error: "Malformed request payload.",
          details
        },
        { status: 400 }
      );
    }

    const { message, sourceGroup, sourceSender, messageTimestamp, sourceMessageId } = parseResult.data;

    // Boundary Check: Messages before September 10, 2026 are strictly ignored
    if (messageTimestamp && !isMessageEligibleForBackfill(messageTimestamp)) {
      recordCollectorMetric({
        message,
        sourceGroup,
        result: "NON_ACADEMIC",
        receivedAt: messageTimestamp
      });
      await updateCollectorGroupCursor(sourceGroup, {
        groupName: sourceGroup,
        messagesScannedIncrement: 1,
        messagesIgnoredIncrement: 1
      });
      return NextResponse.json(
        {
          success: true,
          action: "IGNORED_OUT_OF_RANGE",
          reason: "Message timestamp is prior to the September 10, 2026 initial backfill boundary."
        },
        { status: 200 }
      );
    }

    // 3. Process via Academic Engine Pipeline
    const result = await processAcademicMessagePipeline({
      message,
      source: "WHATSAPP_WEB",
      sourceGroup,
      sourceSender,
      messageTimestamp,
      sourceMessageId
    });

    // 4. Update Collector Metrics & Group State
    recordCollectorMetric({
      message,
      sourceGroup,
      result: result.action,
      receivedAt: messageTimestamp
    });

    await updateCollectorGroupCursor(sourceGroup, {
      groupName: sourceGroup,
      messagesScannedIncrement: 1,
      messagesProcessedIncrement: (result.action === "CREATED" || result.action === "UPDATED") ? 1 : 0,
      messagesIgnoredIncrement: (result.action === "IGNORED_DUPLICATE" || result.action === "NON_ACADEMIC") ? 1 : 0
    });

    // 5. Return Clean Response (Strictly no API keys or internal secrets)
    const statusCode = result.action === "CREATED" ? 201 : 200;
    return NextResponse.json(
      {
        success: true,
        action: result.action,
        item: result.item,
        reason: result.reason,
        changeSummary: result.changeSummary,
        notionSync: result.notionSync ? { status: result.notionSync.status } : undefined
      },
      { status: statusCode }
    );
  } catch (err) {
    console.error("POST /api/collector/messages error:", err);
    recordCollectorMetric({
      message: "Unknown error",
      result: "FAILED"
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal collector processing error." },
      { status: 500 }
    );
  }
}

export async function GET() {
  const stats = getCollectorStats();
  return NextResponse.json({ stats });
}
