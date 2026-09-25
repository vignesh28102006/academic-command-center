import { NextResponse } from "next/server";
import { processAcademicMessage } from "@/lib/events";
import { AcademicItem } from "@/lib/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const existingItems: AcademicItem[] = Array.isArray(body?.existingItems) ? body.existingItems : [];
  const sourceGroup = typeof body?.sourceGroup === "string" ? body.sourceGroup : undefined;
  const sourceSender = typeof body?.sourceSender === "string" ? body.sourceSender : undefined;

  if (!text) {
    return NextResponse.json({ error: "Message text is required." }, { status: 400 });
  }

  const result = processAcademicMessage(text, existingItems, {
    sourceGroup,
    sourceSender
  });

  return NextResponse.json(result);
}