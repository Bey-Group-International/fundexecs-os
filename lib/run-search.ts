// lib/run-search.ts
// The Run-hub evaluation planner. Earn turns an operator's free-text evaluation
// request into a small set of analysis steps, each delegated to the owning Run
// agent (analyst for modeling/underwriting, diligence for risk/document work).
//
// Unlike the Source planner, a Run search produces synthesized ANALYSIS
// deliverables — not DB-inserted candidates — so this module is intentionally
// DB-free and unit-testable. Claude (lib/claude.ts model) reasons over the
// request; when no ANTHROPIC_API_KEY is present a deterministic keyword fallback
// keeps the loop demoable in CI/preview.
import Anthropic from "@anthropic-ai/sdk";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey } from "@/lib/supabase/database.types";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// The Run agents Earn may delegate to.
const RUN_AGENTS: AgentKey[] = ["analyst", "diligence"];

export function runSearchLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

export interface RunSearchStep {
  /** The Run agent that owns this step. */
  agent: AgentKey;
  /** Short imperative title, e.g. "Stress the base case". */
  title: string;
  /** Refined instruction for this step's deliverable. */
  instruction: string;
}
export interface RunSearchPlan {
  summary: string;
  steps: RunSearchStep[];
}

// --- shared helpers --------------------------------------------------------
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const cleanStr = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

function coerceAgent(v: unknown): AgentKey | null {
  return RUN_AGENTS.includes(v as AgentKey) ? (v as AgentKey) : null;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One sentence on what this evaluation will do" },
    steps: {
      type: "array",
      description: "1–4 analysis steps the request implies, best-fit first",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent: { type: "string", enum: RUN_AGENTS },
          title: { type: "string", description: "Short imperative step title" },
          instruction: { type: "string", description: "Refined instruction for the deliverable" },
        },
        required: ["agent", "title", "instruction"],
      },
    },
  },
  required: ["summary", "steps"],
} as const;

// Deterministic plan when no model key is present (or Claude fails): map the
// request to Run agents by keyword. Risk/diligence work → diligence; modeling /
// underwriting / valuation work → analyst; default to both.
function fallbackPlan(prompt: string): RunSearchPlan {
  const t = prompt.toLowerCase();
  const steps: RunSearchStep[] = [];
  const wantsDiligence = /risk|diligence|data room|document|red flag|legal|compliance|covenant/.test(t);
  const wantsAnalyst = /model|underwrit|irr|valuation|return|pro forma|lbo|dcf|sensitivit|comps?/.test(t);

  if (wantsAnalyst) {
    steps.push({
      agent: "analyst",
      title: "Run the underwriting analysis",
      instruction: `Analyze the request and produce the supporting underwriting view: ${prompt}`,
    });
  }
  if (wantsDiligence) {
    steps.push({
      agent: "diligence",
      title: "Surface the key risks",
      instruction: `Flag the material legal, financial, and operational risks for: ${prompt}`,
    });
  }
  if (steps.length === 0) {
    steps.push({
      agent: "analyst",
      title: "Evaluate the financials",
      instruction: `Produce an analytical read on the financials and returns for: ${prompt}`,
    });
    steps.push({
      agent: "diligence",
      title: "Assess diligence readiness",
      instruction: `Assess diligence coverage and surface the open risks for: ${prompt}`,
    });
  }
  return {
    summary: `Evaluate against the portfolio: ${prompt}`.slice(0, 160),
    steps: steps.slice(0, 4),
  };
}

function normalizePlan(raw: Partial<RunSearchPlan> | null, prompt: string): RunSearchPlan {
  if (!raw || !Array.isArray(raw.steps)) return fallbackPlan(prompt);
  const steps: RunSearchStep[] = [];
  for (const r of raw.steps) {
    if (!r || typeof r !== "object") continue;
    const o = r as unknown as Record<string, unknown>;
    const agent = coerceAgent(o.agent);
    if (!agent) continue;
    const title = cleanStr(o.title, 80) || `${AGENT_BY_KEY[agent]?.name ?? "Agent"} review`;
    const instruction = cleanStr(o.instruction, 400) || prompt;
    steps.push({ agent, title, instruction });
    if (steps.length >= 4) break;
  }
  if (steps.length === 0) return fallbackPlan(prompt);
  return {
    summary: cleanStr(raw.summary, 200) || `Evaluate against the portfolio: ${prompt}`.slice(0, 160),
    steps,
  };
}

/**
 * Earn plans an operator's free-text evaluation request into a small set of
 * analysis steps, each delegated to the owning Run agent. Claude-backed with a
 * deterministic keyword fallback. DB-free and unit-testable.
 */
export async function planRunSearch(prompt: string): Promise<RunSearchPlan> {
  const clean = String(prompt ?? "").trim();
  const anthropic = client();
  if (!anthropic) return fallbackPlan(clean);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system:
        `You are Earn, the command layer of FundExecs OS, coordinating the Run team for a private-market operator. ` +
        `The Run team evaluates live deals — it produces synthesized analysis, not new leads. ` +
        `Given an evaluation request, choose the 1–4 analysis steps it implies and write a refined instruction for each. ` +
        `Agents: analyst (models, underwriting, IRR/valuation, sensitivities, comps), ` +
        `diligence (document review, data-room coverage, risk flags, IC-ready diligence memos). ` +
        `Only include the steps the request actually implies.`,
      output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [{ role: "user", content: `Request: ${clean}\n\nReturn the plan.` }],
    });
    const json = textOf(message);
    return normalizePlan(json ? (JSON.parse(json) as Partial<RunSearchPlan>) : null, clean);
  } catch {
    return fallbackPlan(clean);
  }
}

export const __test = {
  fallbackPlan,
  normalizePlan,
  coerceAgent,
  cleanStr,
  RUN_AGENTS,
};
