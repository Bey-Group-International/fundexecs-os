import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

// Haiku is 3-5x faster than Sonnet for live notes — acceptable quality trade-off
const MODEL = process.env.NOTES_MODEL ?? "claude-haiku-4-5-20251001";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export interface LiveNotesResult {
  key_points: string[];
  action_items: string[];
  decisions: string[];
  summary: string;
}

function fallback(): LiveNotesResult {
  return { key_points: [], action_items: [], decisions: [], summary: "" };
}

export async function POST(req: Request) {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      transcript: string;
      newTranscript?: string;
      title?: string;
      participants?: string[];
    };

    if (!body.transcript?.trim()) {
      return NextResponse.json(fallback());
    }

    if (!client) return NextResponse.json(fallback());

    const schema = {
      type: "object" as const,
      properties: {
        key_points: { type: "array", items: { type: "string" } },
        action_items: {
          type: "array",
          items: { type: "string" },
          description: "Each item starts with the owner name if identifiable, e.g. 'Sarah: Send deck by Friday'",
        },
        decisions: { type: "array", items: { type: "string" }, description: "Concrete decisions reached so far" },
        summary: { type: "string", description: "1-2 sentence summary of the discussion so far" },
      },
      required: ["key_points", "action_items", "decisions", "summary"],
    };

    // Only pass new lines to save tokens and reduce latency; full transcript gives context
    const contextText = body.transcript ?? "";
    const newText = body.newTranscript ?? body.transcript ?? "";

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: `You are a real-time meeting copilot. Transcript lines are prefixed "SpeakerName: text".
Use speaker names when assigning action items. Be concise. Return only what is clearly stated.`,
      messages: [
        {
          role: "user",
          content: `Meeting: ${body.title ?? "Untitled"}
Participants: ${body.participants?.join(", ") ?? "Unknown"}

${contextText !== newText ? `FULL TRANSCRIPT (for context):\n${contextText.slice(-6000)}\n\nNEW LINES SINCE LAST UPDATE:\n${newText}` : `TRANSCRIPT SO FAR:\n${contextText.slice(-8000)}`}

Extract cumulative key points, action items with owners, decisions, and a brief running summary.`,
        },
      ],
      tools: [
        {
          name: "structured_output",
          description: "Output structured meeting notes",
          input_schema: schema,
        },
      ],
      tool_choice: { type: "any" },
    });

    const toolUse = msg.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      const result = toolUse.input as LiveNotesResult;
      return NextResponse.json({ ...fallback(), ...result });
    }

    return NextResponse.json(fallback());
  } catch (err) {
    console.error("[/api/meetings/notes]", err);
    return NextResponse.json(fallback());
  }
}
