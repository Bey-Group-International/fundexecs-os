// lib/execute-search.ts
// Earn's planner for the Execute hub's conversational "AI Ops" surface. It turns
// an operator's free-text post-close operations request (LP update, capital-call
// summary, portfolio reporting) into a small set of steps, each delegated to the
// owning Execute agent (Investor Relations, Portfolio Ops, Fund Admin).
//
// Unlike Source's planner — which routes to module candidate generation — the
// Execute planner produces work that ends in synthesized deliverables (the step
// instruction is later handed to lib/claude.ts `executeStep`). Claude reasons
// over the request via a JSON schema; when no ANTHROPIC_API_KEY is present a
// deterministic keyword fallback keeps the loop demoable in CI/preview. The
// engine is DB-free and unit-testable — callers pass only the prompt.
import Anthropic from "@anthropic-ai/sdk";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey } from "@/lib/supabase/database.types";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// The Execute-hub agents Earn can delegate a step to.
const EXECUTE_AGENTS: AgentKey[] = ["investor_relations", "portfolio_ops", "fund_admin"];

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

export interface ExecuteSearchStep {
  /** The Execute agent that owns this step. */
  agent: AgentKey;
  /** Short imperative title, e.g. "Draft the LP quarterly update". */
  title: string;
  /** Instruction handed to the agent to produce the deliverable. */
  instruction: string;
}
export interface ExecuteSearchPlan {
  summary: string;
  steps: ExecuteSearchStep[];
}

const cleanStr = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

function coerceAgent(v: unknown): AgentKey | null {
  return EXECUTE_AGENTS.includes(v as AgentKey) ? (v as AgentKey) : null;
}

// --- shared Claude plumbing -------------------------------------------------
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One sentence on what this ops workflow will do" },
    steps: {
      type: "array",
      description: "1–4 ordered steps, each delegated to the most fitting Execute agent",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent: { type: "string", enum: EXECUTE_AGENTS },
          title: { type: "string", description: "Short imperative step title" },
          instruction: { type: "string", description: "What the agent should produce for this step" },
        },
        required: ["agent", "title", "instruction"],
      },
    },
  },
  required: ["summary", "steps"],
} as const;

const PLAN_SYSTEM =
  `You are Earn, the command layer of FundExecs OS, coordinating the Execute team for a private-market operator. ` +
  `The Execute hub handles post-close operations — LP updates, capital calls and distributions, fund accounting, ` +
  `and portfolio reporting. Given an operations request, choose the 1–4 steps it implies and delegate each to the ` +
  `single most fitting Execute agent:\n` +
  `- investor_relations: LP communications, quarterly/annual updates, capital-call and distribution notices, reporting to investors\n` +
  `- portfolio_ops: asset KPIs, budgets, capex/variance monitoring, portfolio-company operational reporting\n` +
  `- fund_admin: capital-call mechanics, waterfalls, fees, fund accounting, audit prep, back-office\n` +
  `Each step ends in a synthesized written deliverable. Titles are short and imperative.`;

// Deterministic plan when no model key is present (or Claude fails): map the
// request to Execute agents by keyword. Defaults to an IR + Fund Admin pair.
function fallbackPlan(prompt: string): ExecuteSearchPlan {
  const t = prompt.toLowerCase();
  const picks: ExecuteSearchStep[] = [];
  const add = (agent: AgentKey, title: string) => {
    if (picks.some((p) => p.agent === agent)) return;
    picks.push({ agent, title, instruction: prompt });
  };
  if (/\blp\b|lps|update|report|reporting|distribution|investor|communicat|notice/.test(t)) {
    add("investor_relations", "Draft the LP communication");
  }
  if (/capital call|waterfall|\bfee\b|fees|accounting|audit|nav|close|closing/.test(t)) {
    add("fund_admin", "Run the fund-admin work");
  }
  if (/asset|kpi|budget|portfolio|capex|variance|operational|operations|performance/.test(t)) {
    add("portfolio_ops", "Compile the portfolio reporting");
  }
  if (picks.length === 0) {
    add("investor_relations", "Draft the LP communication");
    add("fund_admin", "Run the fund-admin work");
  }
  return { summary: `Execute against the request: ${prompt}`.slice(0, 160), steps: picks.slice(0, 4) };
}

function normalizePlan(raw: Partial<ExecuteSearchPlan> | null, prompt: string): ExecuteSearchPlan {
  if (!raw || !Array.isArray(raw.steps)) return fallbackPlan(prompt);
  const steps: ExecuteSearchStep[] = [];
  for (const r of raw.steps) {
    if (!r || typeof r !== "object") continue;
    const o = r as unknown as Record<string, unknown>;
    const agent = coerceAgent(o.agent);
    if (!agent) continue;
    const title = cleanStr(o.title, 80) || `${AGENT_BY_KEY[agent]?.name ?? "Agent"} step`;
    const instruction = cleanStr(o.instruction, 400) || prompt;
    steps.push({ agent, title, instruction });
    if (steps.length >= 4) break;
  }
  if (steps.length === 0) return fallbackPlan(prompt);
  return {
    summary: cleanStr(raw.summary, 200) || `Execute against the request: ${prompt}`.slice(0, 160),
    steps,
  };
}

/**
 * Earn plans an operator's free-text Execute-hub request into a small set of
 * steps, each delegated to the owning Execute agent. Claude-backed with a
 * deterministic keyword fallback when no API key is configured.
 */
export async function planExecuteSearch(prompt: string): Promise<ExecuteSearchPlan> {
  const anthropic = client();
  if (!anthropic) return fallbackPlan(prompt);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: PLAN_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [{ role: "user", content: `Request: ${prompt}\n\nReturn the plan.` }],
    });
    const json = textOf(message);
    return normalizePlan(json ? (JSON.parse(json) as Partial<ExecuteSearchPlan>) : null, prompt);
  } catch {
    return fallbackPlan(prompt);
  }
}

export const __test = {
  EXECUTE_AGENTS,
  coerceAgent,
  fallbackPlan,
  normalizePlan,
};
