import { NextResponse } from "next/server";
import { analyzeMeeting } from "@/lib/claude";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      title?: string;
      participants?: string[];
      transcript?: string;
      dealContext?: string;
    };

    if (!body.transcript?.trim()) {
      return NextResponse.json({ error: "transcript is required" }, { status: 400 });
    }

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
