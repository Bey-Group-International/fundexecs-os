import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export interface LiveNotesResult {
  key_points: string[];
  action_items: string[];
  summary: string;
}

function fallback(): LiveNotesResult {
  return { key_points: [], action_items: [], summary: "" };
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      transcript: string;
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
        action_items: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["key_points", "action_items", "summary"],
    };

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: `You are a meeting copilot. Analyze the live meeting transcript and extract structured notes.
Return valid JSON matching the schema. Be concise. Action items should start with a verb and name the owner if identifiable.`,
      messages: [
        {
          role: "user",
          content: `Meeting: ${body.title ?? "Untitled"}
Participants: ${body.participants?.join(", ") ?? "Unknown"}

TRANSCRIPT SO FAR:
${body.transcript}

Extract key discussion points, action items, and a brief summary so far.`,
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
      return NextResponse.json(toolUse.input as LiveNotesResult);
    }

    return NextResponse.json(fallback());
  } catch (err) {
    console.error("[/api/meetings/notes]", err);
    return NextResponse.json(fallback());
  }
}
