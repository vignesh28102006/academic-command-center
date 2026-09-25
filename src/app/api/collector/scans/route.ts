import { NextResponse } from "next/server";
import { z } from "zod";
import { createScanRecord, getRecentScans, updateScanRecord } from "@/lib/db/collectorState";
import { verifyCollectorAuth } from "@/lib/collector/auth";

export const dynamic = "force-dynamic";

const scanMutationSchema = z.object({
  id: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional().nullable(),
  status: z.enum(["IN_PROGRESS", "COMPLETED", "FAILED"]).optional(),
  groupsDiscovered: z.number().int().optional(),
  groupsCompleted: z.number().int().optional(),
  groupsFailed: z.number().int().optional(),
  messagesScanned: z.number().int().optional(),
  messagesProcessed: z.number().int().optional(),
  messagesIgnored: z.number().int().optional(),
  eventsCreated: z.number().int().optional(),
  eventsUpdated: z.number().int().optional(),
  error: z.string().optional().nullable()
});

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const auth = verifyCollectorAuth(request);
    if (!auth.authorized) {
      return auth.response!;
    }
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  const scans = await getRecentScans(isNaN(limit) ? 10 : limit);
  return NextResponse.json({
    status: "ok",
    scans
  });
}

export async function POST(request: Request) {
  const auth = verifyCollectorAuth(request);
  if (!auth.authorized) {
    return auth.response!;
  }

  const body = await request.json().catch(() => null);
  const parsed = scanMutationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Malformed scan mutation payload.",
        details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)
      },
      { status: 400 }
    );
  }

  if (parsed.data.id) {
    const updated = await updateScanRecord(parsed.data.id, parsed.data);
    if (!updated) {
      return NextResponse.json(
        { error: `Scan record '${parsed.data.id}' not found.` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      status: "ok",
      scan: updated
    });
  }

  const created = await createScanRecord(parsed.data);
  return NextResponse.json({
    status: "ok",
    scan: created
  }, { status: 201 });
}
