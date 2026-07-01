// lib/handoff.ts — Feature 02: Structured Agent Handoff
// Generates and persists structured handoff packets when control passes between agents.

import { createServiceClient } from "@/lib/supabase/server";

export interface HandoffPacket {
  summary: string;
  open_questions: string[];
  recommended_focus: string;
  artifact_ids: string[];
}

export async function generateHandoffPacket(args: {
  stepOutput: string;
  fromAgent: string;
  toAgent: string;
  taskId: string;
  stepId: string;
}): Promise<HandoffPacket> {
  const { stepOutput, fromAgent, toAgent, taskId, stepId } = args;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return {
      summary: stepOutput.slice(0, 200),
      open_questions: [],
      recommended_focus: "Review prior step output",
      artifact_ids: [],
    };
  }

  const userMessage = `
Task ID: ${taskId}
Step ID: ${stepId}
From Agent: ${fromAgent}
To Agent: ${toAgent}

Completed Step Output:
${stepOutput}

Produce a JSON handoff packet with exactly these fields:
{
  "summary": "<concise summary of what was accomplished>",
  "open_questions": ["<question 1>", "..."],
  "recommended_focus": "<what the incoming agent should prioritize>",
  "artifact_ids": ["<artifact id if mentioned>", "..."]
}

Return only valid JSON, no markdown fences.
`.trim();

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system:
          "You are a handoff coordinator. Summarize completed work and brief the incoming agent.",
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const packet = JSON.parse(text) as HandoffPacket;

    // Validate required fields are present
    return {
      summary: typeof packet.summary === "string" ? packet.summary : stepOutput.slice(0, 200),
      open_questions: Array.isArray(packet.open_questions) ? packet.open_questions : [],
      recommended_focus:
        typeof packet.recommended_focus === "string"
          ? packet.recommended_focus
          : "Review prior step output",
      artifact_ids: Array.isArray(packet.artifact_ids) ? packet.artifact_ids : [],
    };
  } catch {
    return {
      summary: stepOutput.slice(0, 200),
      open_questions: [],
      recommended_focus: "Review prior step output",
      artifact_ids: [],
    };
  }
}

export async function persistHandoffPacket(
  stepId: string,
  packet: HandoffPacket,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("task_steps")
    .update({ handoff_packet: packet } as Record<string, unknown>)
    .eq("id", stepId);

  // Ignore errors caused by missing column or other non-critical failures
  if (error && !error.message.includes("column") && !error.message.includes("handoff_packet")) {
    console.error("[handoff] Failed to persist handoff packet:", error.message);
  }
}
