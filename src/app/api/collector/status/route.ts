import { NextResponse } from "next/server";
import { getCollectorStats, updateCollectorChatState } from "@/lib/collector/stats";
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = getCollectorStats();
  return NextResponse.json({
    status: "ok",
    stats
  });
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const serverSecret = process.env.COLLECTOR_SECRET;

    if (serverSecret && authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token !== serverSecret) {
        return NextResponse.json({ error: "Invalid collector secret." }, { status: 403 });
      }
    }

    const body = await request.json().catch(() => ({}));
    updateCollectorChatState({
      currentGroup: body.currentGroup,
      chatType: body.chatType,
      collectionStatus: body.collectionStatus
    });

    return NextResponse.json({
      status: "ok",
      stats: getCollectorStats()
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update collector status." },
      { status: 500 }
    );
  }
}
