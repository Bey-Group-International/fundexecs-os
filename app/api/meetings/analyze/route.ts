import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { analyzeMeeting } from "@/lib/claude";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json() as {
      title?: string;
      participants?: string[];
      transcript?: string;
      dealContext?: string;
    };

    if (!body.transcript?.trim()) {
      return NextResponse.json({ error: "transcript is required" }, { status: 400 });
    }

    // Pre-flight credit gate: transcript analysis calls Claude directly,
    // outside the task engine's per-step spendCredits gate.
    const gate = await gateConversationalSpend(auth.ctx.orgId, CONVERSATIONAL_COST.meetingAnalyze, "meeting_analyze");
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const analysis = await analyzeMeeting({
      title: body.title ?? "Untitled meeting",
      participants: Array.isArray(body.participants) ? body.participants : [],
      transcript: body.transcript,
      dealContext: body.dealContext,
    });

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("[/api/meetings/analyze]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
