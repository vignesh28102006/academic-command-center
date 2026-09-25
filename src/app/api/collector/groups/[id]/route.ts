import { NextResponse } from "next/server";
import { getCollectorGroupByRef } from "@/lib/db/collectorState";
import { verifyCollectorAuth } from "@/lib/collector/auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const auth = verifyCollectorAuth(request);
    if (!auth.authorized) {
      return auth.response!;
    }
  }

  const { id } = await Promise.resolve(params);
  const group = await getCollectorGroupByRef(id);
  if (!group) {
    return NextResponse.json(
      { error: `Group '${id}' not found.` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    status: "ok",
    group
  });
}
