import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export async function POST(req: Request) {
  try {
    const supabase = createServerClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      meetingId: string;
      title?: string;
      participants?: string[];
      transcript: string;
      duration?: number;
    };

    if (!body.meetingId || !body.transcript?.trim()) {
      return NextResponse.json({ error: "meetingId and transcript required" }, { status: 400 });
    }

    // Verify caller is the meeting host
    const { data: meeting } = await supabase
      .from("live_meetings")
      .select("id, host_id")
      .eq("id", body.meetingId)
      .single();

    if (!meeting || meeting.host_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cap transcript to ~12 000 chars to stay within model context / cost budget
    const transcript = body.transcript.length > 12_000
      ? body.transcript.slice(-12_000)
      : body.transcript;

    let analysis: Record<string, unknown> = { key_points: [], action_items: [], summary: "" };

    if (client) {
      const schema = {
        type: "object" as const,
        properties: {
          summary: { type: "string", description: "2-3 sentence meeting summary" },
          key_points: { type: "array", items: { type: "string" }, description: "Main discussion points" },
          action_items: { type: "array", items: { type: "string" }, description: "Action items with owners" },
          decisions: { type: "array", items: { type: "string" }, description: "Key decisions made" },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          follow_up_draft: { type: "string", description: "Draft follow-up email" },
        },
        required: ["summary", "key_points", "action_items", "decisions", "sentiment", "follow_up_draft"],
      };

      const durationMin = body.duration ? Math.round(body.duration / 60) : null;

      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: "You are an expert meeting analyst. Produce comprehensive, actionable meeting reports.",
        messages: [
          {
            role: "user",
            content: `Meeting: ${body.title ?? "Untitled"}
Participants: ${body.participants?.join(", ") ?? "Unknown"}
${durationMin ? `Duration: ~${durationMin} minutes` : ""}

FULL TRANSCRIPT:
${transcript}

Generate a comprehensive post-meeting report.`,
          },
        ],
        tools: [
          {
            name: "meeting_report",
            description: "Generate structured meeting report",
            input_schema: schema,
          },
        ],
        tool_choice: { type: "any" },
      });

      const toolUse = msg.content.find((b) => b.type === "tool_use");
      if (toolUse && toolUse.type === "tool_use") {
        analysis = toolUse.input as Record<string, unknown>;
      }
    }

    // Save to DB
    const { data: report, error } = await supabase
      .from("live_meeting_reports")
      .insert({
        meeting_id: body.meetingId,
        summary: analysis.summary as string,
        key_points: analysis.key_points,
        action_items: analysis.action_items,
        full_transcript: transcript,
        analysis,
      })
      .select("id")
      .single();

    if (error) throw error;

    // Mark meeting as ended
    await supabase
      .from("live_meetings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", body.meetingId);

    return NextResponse.json({ reportId: report.id, analysis });
  } catch (err) {
    console.error("[/api/meetings/report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 },
    );
  }
}
