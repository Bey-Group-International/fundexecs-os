import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { createTeamTask } from "@/lib/team-tasks";

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
      .select("id, host_id, organization_id, title")
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
          action_items: {
            type: "array",
            items: { type: "string" },
            description: "Action items prefixed with owner name, e.g. 'Sarah: Send deck by Friday'",
          },
          decisions: { type: "array", items: { type: "string" }, description: "Key decisions reached" },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
          next_meeting_suggestion: {
            type: "string",
            description: "One sentence suggesting when to meet next and why, or empty string if not applicable",
          },
          follow_up_draft: {
            type: "string",
            description: "Complete follow-up email including: greeting, 1-paragraph summary, bullet list of decisions made, numbered action items with owners, next meeting proposal (if applicable), and professional sign-off. Use plain text, no markdown.",
          },
        },
        required: ["summary", "key_points", "action_items", "decisions", "sentiment", "next_meeting_suggestion", "follow_up_draft"],
      };

      const durationMin = body.duration ? Math.round(body.duration / 60) : null;

      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: `You are an expert meeting analyst for a venture-capital / investor-relations platform.
Produce comprehensive, actionable meeting reports. Transcript lines are prefixed "SpeakerName: text" — use speaker names when assigning action items.
For the follow_up_draft, write a ready-to-send professional email covering: (1) brief summary paragraph, (2) decisions made, (3) numbered action items with owners and deadlines where stated, (4) proposed next meeting if relevant, (5) professional closing. Plain text only.`,
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
        key_points: analysis.key_points as import("@/lib/supabase/database.types").Json,
        action_items: analysis.action_items as import("@/lib/supabase/database.types").Json,
        full_transcript: transcript,
        analysis: analysis as import("@/lib/supabase/database.types").Json,
      })
      .select("id")
      .single();

    if (error) throw error;

    // Mark meeting as ended
    await supabase
      .from("live_meetings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", body.meetingId);

    // Fire-and-forget: create a task for each action item
    const actionItems = Array.isArray(analysis.action_items) ? analysis.action_items as string[] : [];
    if (actionItems.length > 0 && meeting.organization_id) {
      void Promise.allSettled(
        actionItems.map((item) =>
          createTeamTask(supabase, {
            organizationId: meeting.organization_id!,
            assignedTo: user.id,
            assignedBy: user.id,
            title: item.slice(0, 120),
            description: `Auto-created from meeting: ${meeting.title ?? body.title ?? "Untitled"}`,
            hub: "execute",
            module: "live_meetings",
            priority: "normal",
            contextSnapshot: (analysis.summary as string) ?? "",
          }),
        ),
      );
    }

    return NextResponse.json({ reportId: report.id, analysis });
  } catch (err) {
    console.error("[/api/meetings/report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 },
    );
  }
}
