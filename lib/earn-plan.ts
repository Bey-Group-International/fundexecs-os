// Earn's directive-planning skill: turn an operator's directive into a
// recommendation — delegate to the executive team (A) or have Earn execute
// directly (B) — plus concrete action bullets and a closing next-step line.
//
// This is the reusable core the session composer ("Plan with Earn") and the
// Build hub's Plan module both call. It replaces the Command Center's
// world-coupled planner: same Claude call and deterministic-fallback
// convention (lib/claude.ts), but it returns the plain plan instead of a
// spatial Step[] timeline, so it has no dependency on the retired world engine.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, INTERACTIVE_TIMEOUT_MS } from "@/lib/anthropic-client";
import { effortConfig } from "@/lib/claude";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export type PlanKind = "A" | "B";

export interface EarnPlan {
  /** A = delegate to the executive team; B = Earn executes directly. */
  kind: PlanKind;
  /** One-sentence recommendation in Earn's voice — the play. */
  recommendation: string;
  /** 2-5 concrete action lines, each naming the responsible executive. */
  bullets: string[];
  /** One-sentence closing: plausible first-pass progress + a next-step question. */
  closing: string;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["A", "B"],
      description:
        "A = delegate to the executive team to run in parallel (raises, outreach, sourcing, multi-workstream campaigns). B = Earn executes directly (a tight reasoning loop: tighten a thesis, draft a memo, review diligence).",
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
        "One sentence reporting plausible first-pass progress and asking a next-step question.",
    },
  },
  required: ["kind", "recommendation", "bullets", "closing"],
} as const;

const SYSTEM_PROMPT =
  `You are Earn, the AI COO of a private-capital firm, orchestrating an executive team ` +
  `(Capital Raiser, Investor Relations, Rainmaker, Lead Generator, Analyst, Diligence). ` +
  `Given the operator's directive, decide how to run it: kind "A" delegates to the team to ` +
  `work in parallel (raises, outreach, sourcing, multi-workstream campaigns); kind "B" is a ` +
  `tight reasoning loop you take directly (tighten a thesis, draft a memo, review diligence). ` +
  `Then write, in your own decisive COO voice: a one-sentence recommendation (the play), ` +
  `2-5 concrete action bullets each naming the responsible executive, and a closing line that ` +
  `reports plausible first-pass progress and asks a next-step question. Ground everything in ` +
  `real fund operations — no filler.`;

// Cheap intent match used by the fallback to pick delegate-vs-execute the same
// way the model is told to.
function fallbackKind(prompt: string): PlanKind {
  return /thesis|tighten|review|flag|diligence|memo|check|refine|analy[sz]e|draft/i.test(prompt)
    ? "B"
    : "A";
}

// Deterministic fallback — runs when ANTHROPIC_API_KEY is absent or the model
// call fails, so CI/preview and the no-key path still return a usable plan.
export function fallbackPlan(prompt: string): EarnPlan {
  const kind = fallbackKind(prompt);
  const focus = prompt.trim() || "this directive";
  if (kind === "A") {
    return {
      kind: "A",
      recommendation: `I'll delegate ${lowerFirst(focus)} to the team and run the workstreams in parallel.`,
      bullets: [
        "Capital Raiser opens the anchor-LP outreach",
        "Investor Relations stages the data room and LP update",
        "Rainmaker sequences warm intros from the relationship graph",
        "Lead Generator runs the qualified-LP funnel",
      ],
      closing: "First pass is underway across the team — want me to schedule the follow-up calls?",
    };
  }
  return {
    kind: "B",
    recommendation: `I'll take ${lowerFirst(focus)} directly — it's a tight reasoning loop, not a campaign.`,
    bullets: [
      "I rework the substance for focus and discipline",
      "Analyst pulls comps to pressure-test the numbers",
      "Diligence sweeps for open risk flags",
    ],
    closing: "Draft is tightening now with the gaps flagged — ready for me to send it?",
  };
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function normalizePlan(raw: unknown, prompt: string): EarnPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === "A" || r.kind === "B" ? (r.kind as PlanKind) : null;
  if (!kind) return null;
  const recommendation = typeof r.recommendation === "string" ? r.recommendation.trim() : "";
  if (!recommendation) return null;
  const bullets = Array.isArray(r.bullets)
    ? r.bullets
        .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
        .map((b) => b.trim().slice(0, 200))
        .slice(0, 5)
    : [];
  if (bullets.length === 0) return null;
  const closing =
    typeof r.closing === "string" && r.closing.trim()
      ? r.closing.trim()
      : fallbackPlan(prompt).closing;
  return { kind, recommendation, bullets, closing };
}

/**
 * Produce Earn's plan for an operator directive. Never throws — with no API key
 * or on any model/parse error it returns the deterministic fallback plan.
 */
export async function planEarnDirective(input: { prompt: string }): Promise<EarnPlan> {
  const prompt = input.prompt.trim();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackPlan(prompt);

  try {
    const anthropic = anthropicClient(apiKey, INTERACTIVE_TIMEOUT_MS);
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      ...effortConfig(MODEL, "low", PLAN_SCHEMA),
      messages: [{ role: "user", content: `Operator directive: ${prompt}` }],
    });
    const json = textOf(message);
    if (!json) return fallbackPlan(prompt);
    const plan = normalizePlan(JSON.parse(json), prompt);
    return plan ?? fallbackPlan(prompt);
  } catch (err) {
    console.error("[planEarnDirective] Claude API error:", err);
    return fallbackPlan(prompt);
  }
}
