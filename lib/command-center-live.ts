// Live-Earn driver for the Command Center. Turns an operator's directive into
// the same Step[] timeline the scripted flows use — but with Claude choosing the
// flow (delegate vs execute) and writing Earn's recommendation, action bullets,
// and closing line for THIS prompt. The world choreography (moves, assigns,
// gates) is preserved from the flow template so the spatial animation stays
// valid; only Earn's dialogue is synthesized.
//
// Follows the repo's deterministic-fallback convention (lib/claude.ts): with no
// ANTHROPIC_API_KEY, or on any model/parse error, it returns the scripted flow
// with the operator's prompt swapped in — so CI/preview and the no-key demo keep
// working. This is the "live Earn adapter" the flows.ts + adapter.ts comments
// anticipate.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, INTERACTIVE_TIMEOUT_MS } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";
import { FLOW_A, FLOW_B } from "@/lib/command-center/flows";
import type { Step } from "@/lib/command-center/engine";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export type FlowKind = "A" | "B";
export interface EarnPlan {
  kind: FlowKind;
  steps: Step[];
}

// What Claude fills in; the rest of each flow's timeline is templated.
interface EarnDialogue {
  kind: FlowKind;
  recommendation: string;
  bullets: string[];
  closing: string;
}

const DIALOGUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["A", "B"],
      description:
        "A = delegate to the executive team to run in parallel (campaigns, outreach, multi-workstream). B = Earn executes directly (a tight reasoning loop: thesis, memo, diligence review).",
    },
    recommendation: {
      type: "string",
      description: "One sentence in Earn's voice stating the play. No preamble.",
    },
    bullets: {
      type: "array",
      description:
        "2-5 concrete action lines, each naming the responsible executive (e.g. Capital Raiser, Investor Relations, Rainmaker, Lead Generator, Analyst, Diligence).",
      items: { type: "string" },
    },
    closing: {
      type: "string",
      description:
        "One sentence reporting first-pass progress and asking a next-step question.",
    },
  },
  required: ["kind", "recommendation", "bullets", "closing"],
} as const;

const SYSTEM_PROMPT =
  `You are Earn, the AI COO orchestrating a private-capital firm's executive team ` +
  `(Capital Raiser, Investor Relations, Rainmaker, Lead Generator, Analyst, Diligence). ` +
  `Given the operator's directive, decide how to run it: kind "A" delegates to the team to ` +
  `work in parallel (raises, outreach, sourcing, multi-workstream campaigns); kind "B" is a ` +
  `tight reasoning loop you take directly (tighten a thesis, draft a memo, review diligence). ` +
  `Then write, in your own decisive COO voice: a one-sentence recommendation (the play), ` +
  `2-5 concrete action bullets each naming the responsible executive, and a closing line that ` +
  `reports plausible first-pass progress and asks a next-step question. Ground everything in ` +
  `real fund operations — no filler.`;

const BASE: Record<FlowKind, Step[]> = { A: FLOW_A, B: FLOW_B };

// Overlay Claude's dialogue onto a flow template: swap the opening user line for
// the operator's prompt, the approval-gated earn line for the recommendation +
// bullets, and the final earn line for the closing. Everything else (phases,
// moves, assigns, gates) is preserved so the world animation stays valid.
function applyDialogue(prompt: string, d: EarnDialogue): Step[] {
  const base = BASE[d.kind];
  let lastEarnIdx = -1;
  base.forEach((s, i) => {
    if (s.kind === "say" && s.role === "earn") lastEarnIdx = i;
  });

  return base.map((step, i) => {
    if (step.kind !== "say") return step;
    if (step.role === "user") return { ...step, text: prompt };
    if (step.role === "earn") {
      if (step.awaitsApproval) {
        return {
          ...step,
          text: d.recommendation || step.text,
          detail: d.bullets.length ? d.bullets : step.detail,
        };
      }
      if (i === lastEarnIdx) return { ...step, text: d.closing || step.text };
    }
    return step;
  });
}

// Deterministic fallback: pick the flow the way the scripted driver does (cheap
// intent match), then swap the operator's prompt into the opening line.
function fallbackPlan(prompt: string): EarnPlan {
  const direct = /thesis|tighten|review|flag|diligence|memo|check|refine/i.test(prompt);
  const kind: FlowKind = direct ? "B" : "A";
  const steps = BASE[kind].map((step) =>
    step.kind === "say" && step.role === "user" ? { ...step, text: prompt } : step,
  );
  return { kind, steps };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function normalizeDialogue(raw: unknown): EarnDialogue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === "A" || r.kind === "B" ? (r.kind as FlowKind) : null;
  if (!kind) return null;
  const recommendation = typeof r.recommendation === "string" ? r.recommendation.trim() : "";
  const closing = typeof r.closing === "string" ? r.closing.trim() : "";
  const bullets = Array.isArray(r.bullets)
    ? r.bullets
        .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
        .map((b) => b.trim().slice(0, 160))
        .slice(0, 5)
    : [];
  if (!recommendation) return null;
  return { kind, recommendation, bullets, closing };
}

/**
 * Produce the Command Center timeline for an operator directive. Never throws —
 * with no API key or on any error it returns the deterministic scripted plan.
 */
export async function planLiveEarn(input: { prompt: string }): Promise<EarnPlan> {
  const prompt = input.prompt.trim();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackPlan(prompt);

  try {
    const anthropic = anthropicClient(apiKey, INTERACTIVE_TIMEOUT_MS);
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "low", DIALOGUE_SCHEMA),
      messages: [{ role: "user", content: `Operator directive: ${prompt}` }],
    });
    const json = textOf(message);
    if (!json) return fallbackPlan(prompt);
    const dialogue = normalizeDialogue(JSON.parse(json));
    if (!dialogue) return fallbackPlan(prompt);
    return { kind: dialogue.kind, steps: applyDialogue(prompt, dialogue) };
  } catch (err) {
    console.error("[planLiveEarn] Claude API error:", err);
    return fallbackPlan(prompt);
  }
}
