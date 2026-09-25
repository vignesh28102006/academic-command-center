import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllCollectorGroups, getOrCreateCollectorGroup } from "@/lib/db/collectorState";
import { verifyCollectorAuth } from "@/lib/collector/auth";

export const dynamic = "force-dynamic";

const registerGroupSchema = z.object({
  groupName: z.string().min(1, "groupName cannot be empty"),
  groupIdentifier: z.string().optional(),
  status: z.enum([
    "IDLE",
    "DISCOVERING_GROUPS",
    "BACKFILLING",
    "MONITORING",
    "SCANNING",
    "PAUSED",
    "ERROR",
    "WHATSAPP_UNAVAILABLE"
  ]).optional()
});

export async function GET(request: Request) {
  // If authorization header is provided, verify it
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const auth = verifyCollectorAuth(request);
    if (!auth.authorized) {
      return auth.response!;
    }
  }

  const groups = await getAllCollectorGroups();
  return NextResponse.json({
    status: "ok",
    groups
  });
}

export async function POST(request: Request) {
  const auth = verifyCollectorAuth(request);
  if (!auth.authorized) {
    return auth.response!;
  }

  const body = await request.json().catch(() => null);
  const parsed = registerGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Malformed request payload.", details: parsed.error.issues.map(i => i.message) },
      { status: 400 }
    );
  }

  const group = await getOrCreateCollectorGroup(
    parsed.data.groupName,
    parsed.data.groupIdentifier
  );

  return NextResponse.json({
    status: "ok",
    group
  }, { status: 201 });
}
