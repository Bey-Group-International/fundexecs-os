// Claude-powered planning + execution for the AI Agent Copilot.
//
// A prompt becomes a multi-step PLAN (each step delegated to one of the six
// agents), then each step is EXECUTED to produce a deliverable. Both use
// Claude (claude-opus-4-8). When ANTHROPIC_API_KEY is absent, both fall back to
// a deterministic result so the app — and CI/preview builds — keep working.
import Anthropic from "@anthropic-ai/sdk";
import type { AgentKey, Hub } from "@/lib/supabase/database.types";
import { AGENTS } from "@/lib/agents";

const MODEL = "claude-opus-4-8";

export interface PlanStep {
  agent: AgentKey;
  title: string;
  description: string;
}
export interface AgentPlan {
  title: string;
  hub: Hub;
  summary: string;
  steps: PlanStep[];
}

const AGENT_KEYS = AGENTS.map((a) => a.key);
const HUBS: Hub[] = ["build", "source", "run", "execute"];

export function copilotLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : null;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Short title for the overall workflow" },
    hub: { type: "string", enum: HUBS },
    summary: { type: "string", description: "One sentence on what the workflow achieves" },
    steps: {
      type: "array",
      description: "2-4 ordered steps, each delegated to the most fitting agent",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent: { type: "string", enum: AGENT_KEYS },
          title: { type: "string", description: "Short imperative step title" },
          description: { type: "string", description: "One line on what the agent does" },
        },
        required: ["agent", "title", "description"],
      },
    },
  },
  required: ["title", "hub", "summary", "steps"],
} as const;

const PLAN_SYSTEM = `You are the Associate — the orchestration agent of FundExecs OS, an operating system for private-market investors (PE funds, family offices, real estate).
Given an operator's prompt, produce a concise multi-step plan. Delegate each step to the single most appropriate agent:
- analyst: deal data, pro formas, valuations, LBO/DCF models, sensitivities
- associate: coordination, sourcing, pipeline intake, drafting
- investor_relations: LP communications, capital calls, fundraising, reporting
- portfolio_ops: asset KPIs, budgets, capex, variance
- diligence: document parsing, data-room indexing, risk flags, diligence memos
- fund_admin: waterfalls, fund accounting, audit prep, closing mechanics
Choose the hub (build/source/run/execute) that best fits the work. Keep to 2-4 steps. Titles are short and imperative.`;

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function normalizePlan(raw: Partial<AgentPlan> | null, prompt: string): AgentPlan {
  const fallback = fallbackPlan(prompt);
  if (!raw || !Array.isArray(raw.steps) || raw.steps.length === 0) return fallback;
  const steps = raw.steps
    .filter((s) => s && AGENT_KEYS.includes(s.agent as AgentKey))
    .slice(0, 5)
    .map((s) => ({
      agent: s.agent as AgentKey,
      title: String(s.title ?? "Step").slice(0, 80),
      description: String(s.description ?? "").slice(0, 240),
    }));
  if (steps.length === 0) return fallback;
  return {
    title: String(raw.title ?? fallback.title).slice(0, 90),
    hub: HUBS.includes(raw.hub as Hub) ? (raw.hub as Hub) : fallback.hub,
    summary: String(raw.summary ?? fallback.summary).slice(0, 240),
    steps,
  };
}

export async function generatePlan(prompt: string): Promise<AgentPlan> {
  const anthropic = client();
  if (!anthropic) return fallbackPlan(prompt);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: PLAN_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    const json = textOf(message);
    return normalizePlan(json ? (JSON.parse(json) as AgentPlan) : null, prompt);
  } catch {
    return fallbackPlan(prompt);
  }
}

export async function executeStep(args: {
  workflowTitle: string;
  agent: AgentKey;
  stepTitle: string;
  stepDescription: string;
  priorOutputs: string[];
}): Promise<string> {
  const anthropic = client();
  if (!anthropic) return fallbackStepOutput(args);
  const agentName = AGENTS.find((a) => a.key === args.agent)?.name ?? args.agent;
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1400,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: `You are the ${agentName} agent inside FundExecs OS. Produce a crisp, professional deliverable for your assigned step. Lead with the outcome. No preamble.`,
      messages: [
        {
          role: "user",
          content:
            `Workflow: ${args.workflowTitle}\n` +
            `Your step: ${args.stepTitle} — ${args.stepDescription}\n\n` +
            `Context from earlier steps:\n${args.priorOutputs.join("\n\n") || "(none)"}\n\n` +
            `Produce your deliverable for this step concisely.`,
        },
      ],
    });
    return textOf(message) || fallbackStepOutput(args);
  } catch {
    return fallbackStepOutput(args);
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallbacks (no API key) — keep the loop demoable everywhere.
// ---------------------------------------------------------------------------
function fallbackPlan(prompt: string): AgentPlan {
  const t = prompt.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  let hub: Hub = "run";
  let steps: PlanStep[];
  if (has("underwrit", "model", "lbo", "dcf", "valuation", "irr")) {
    hub = "run";
    steps = [
      { agent: "analyst", title: "Build the model", description: "Construct the underwriting model and base-case projections." },
      { agent: "analyst", title: "Run sensitivities", description: "Stress key assumptions and report the return range." },
      { agent: "associate", title: "Summarize for IC", description: "Draft the recommendation summary." },
    ];
  } else if (has("diligence", "data room", "document", "risk")) {
    hub = "run";
    steps = [
      { agent: "diligence", title: "Index the data room", description: "Parse documents and build the entity graph." },
      { agent: "diligence", title: "Flag risks", description: "Surface legal, financial, and operational risks." },
    ];
  } else if (has("lp", "investor", "capital call", "fundrais", "distribution")) {
    hub = "execute";
    steps = [
      { agent: "investor_relations", title: "Identify LP targets", description: "Match the raise to fitting investors." },
      { agent: "investor_relations", title: "Draft outreach", description: "Prepare LP communication and materials." },
    ];
  } else if (has("source", "pipeline", "deal", "target")) {
    hub = "source";
    steps = [
      { agent: "associate", title: "Source targets", description: "Surface candidates matching the thesis." },
      { agent: "analyst", title: "Screen candidates", description: "Score and rank against thesis fit." },
    ];
  } else {
    steps = [
      { agent: "associate", title: "Analyze & draft plan", description: "Interpret the request and outline the work." },
      { agent: "analyst", title: "Execute analysis", description: "Produce the supporting analysis." },
    ];
  }
  return { title: prompt.trim().slice(0, 80) || "Workflow", hub, summary: "Planned by the Associate.", steps };
}

function fallbackStepOutput(args: { stepTitle: string; agent: AgentKey }): string {
  const agentName = AGENTS.find((a) => a.key === args.agent)?.name ?? args.agent;
  return `[${agentName}] Completed: ${args.stepTitle}. (Connect ANTHROPIC_API_KEY for a full AI-generated deliverable.)`;
}
