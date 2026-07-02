import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { draftOutreachMessage } from "@/lib/network-outreach";
import type { DraftOutreachParams } from "@/lib/network-outreach";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body: DraftOutreachParams = await req.json().catch(() => null);
  if (!body?.targetName || !body?.context) {
    return NextResponse.json({ error: "targetName and context are required" }, { status: 400 });
  }

  try {
    const draft = await draftOutreachMessage(body);
    return NextResponse.json(draft);
  } catch (err) {
    console.error("[network/draft]", err);
    return NextResponse.json({ error: "Draft failed" }, { status: 500 });
  }
}
