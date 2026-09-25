import { NextResponse } from "next/server";
import { getCollectorStats } from "@/lib/collector/stats";
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = getCollectorStats();
  return NextResponse.json({
    status: "ok",
    stats
  });
}
