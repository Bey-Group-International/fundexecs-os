// Claude-powered planning + execution for the AI Agent Copilot.
//
// A prompt becomes a multi-step PLAN (each step delegated to one of the six
// agents), then each step is EXECUTED to produce a deliverable. Both use
// Claude (claude-opus-4-8). When ANTHROPIC_API_KEY is absent, both fall back to
// a deterministic result so the app — and CI/preview builds — keep working.
import Anthropic from "@anthropic-ai/sdk";
import type { AgentKey, Hub, AssetType } from "@/lib/supabase/database.types";
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

export interface DealFields {
  name: string;
  asset_class: string | null;
  geography: string | null;
  target_amount: number | null;
}

export interface AssetFields {
  name: string;
  asset_type: AssetType;
  current_value: number | null;
}

const AGENT_KEYS = AGENTS.map((a) => a.key);
const HUBS: Hub[] = ["build", "source", "run", "execute"];
const ASSET_TYPES: AssetType[] = [
  "real_estate",
  "operating_company",
  "portfolio_company",
  "fund_interest",
  "other",
];

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
// Structured extraction — turn a completed workflow into a Deal / Asset record.
// Claude reads the prompt + step deliverables and returns typed fields; a
// deterministic parse fills in when no API key is present.
// ---------------------------------------------------------------------------
const DEAL_FIELDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "Concise deal name (the target company or asset)" },
    asset_class: {
      type: ["string", "null"],
      description: "e.g. multifamily, office, industrial, retail, SaaS, healthcare services",
    },
    geography: {
      type: ["string", "null"],
      description: "Primary market or region, e.g. 'Austin, TX' or 'Southeast US'",
    },
    target_amount: {
      type: ["number", "null"],
      description: "Target deal size or equity in whole USD (number only, no symbols)",
    },
  },
  required: ["name", "asset_class", "geography", "target_amount"],
} as const;

const ASSET_FIELDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "Concise asset name" },
    asset_type: { type: "string", enum: ASSET_TYPES },
    current_value: {
      type: ["number", "null"],
      description: "Current or acquisition value in whole USD (number only)",
    },
  },
  required: ["name", "asset_type", "current_value"],
} as const;

const EXTRACT_SYSTEM = `You extract structured private-market record fields from an operator's request and the work the agents produced. Return only fields you can justify from the text; use null when a value is not stated or clearly implied. Never invent figures.`;

function extractContent(args: { title: string; prompt: string; context: string }): string {
  return (
    `Workflow: ${args.title}\n` +
    `Original request: ${args.prompt}\n\n` +
    `Agent deliverables:\n${args.context || "(none)"}\n\n` +
    `Extract the record fields.`
  );
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, 120) : null;
}

function cleanNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function extractDealFields(args: {
  title: string;
  prompt: string;
  context: string;
}): Promise<DealFields> {
  const anthropic = client();
  if (!anthropic) return fallbackDealFields(args);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: EXTRACT_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: DEAL_FIELDS_SCHEMA } },
      messages: [{ role: "user", content: extractContent(args) }],
    });
    const json = textOf(message);
    if (!json) return fallbackDealFields(args);
    const raw = JSON.parse(json) as Partial<DealFields>;
    const fb = fallbackDealFields(args);
    return {
      name: cleanStr(raw.name) ?? fb.name,
      asset_class: cleanStr(raw.asset_class),
      geography: cleanStr(raw.geography),
      target_amount: cleanNum(raw.target_amount) ?? fb.target_amount,
    };
  } catch {
    return fallbackDealFields(args);
  }
}

export async function extractAssetFields(args: {
  title: string;
  prompt: string;
  context: string;
}): Promise<AssetFields> {
  const anthropic = client();
  if (!anthropic) return fallbackAssetFields(args);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: EXTRACT_SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: ASSET_FIELDS_SCHEMA } },
      messages: [{ role: "user", content: extractContent(args) }],
    });
    const json = textOf(message);
    if (!json) return fallbackAssetFields(args);
    const raw = JSON.parse(json) as Partial<AssetFields>;
    const fb = fallbackAssetFields(args);
    return {
      name: cleanStr(raw.name) ?? fb.name,
      asset_type: ASSET_TYPES.includes(raw.asset_type as AssetType) ? (raw.asset_type as AssetType) : fb.asset_type,
      current_value: cleanNum(raw.current_value),
    };
  } catch {
    return fallbackAssetFields(args);
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

// Parse the first plausible USD figure ("$25M", "12.5 million", "$3,000,000").
function parseUsdAmount(text: string): number | null {
  const m = text.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m|mm|bn?|thousand|million|billion)?/i);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const mult =
    unit === "k" || unit === "thousand"
      ? 1e3
      : unit === "m" || unit === "mm" || unit === "million"
        ? 1e6
        : unit === "b" || unit === "bn" || unit === "billion"
          ? 1e9
          : 1;
  return base * mult;
}

const ASSET_CLASS_KEYWORDS: [RegExp, string][] = [
  [/multifamily|apartment/i, "Multifamily"],
  [/\boffice\b/i, "Office"],
  [/industrial|warehouse|logistics/i, "Industrial"],
  [/\bretail\b/i, "Retail"],
  [/hotel|hospitality/i, "Hospitality"],
  [/\bsaas\b|software/i, "SaaS"],
  [/healthcare|medical/i, "Healthcare"],
];

function classifyAssetClass(text: string): string | null {
  return ASSET_CLASS_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

function fallbackDealFields(args: { title: string; prompt: string; context: string }): DealFields {
  const blob = `${args.title}\n${args.prompt}`;
  return {
    name: args.title.trim().slice(0, 120) || "Untitled deal",
    asset_class: classifyAssetClass(blob),
    geography: null,
    target_amount: parseUsdAmount(args.prompt),
  };
}

const REAL_ESTATE_CLASSES = new Set(["Multifamily", "Office", "Industrial", "Retail", "Hospitality"]);

function fallbackAssetFields(args: { title: string; prompt: string; context: string }): AssetFields {
  const blob = `${args.title}\n${args.prompt}`;
  const cls = classifyAssetClass(blob);
  const asset_type: AssetType =
    cls && REAL_ESTATE_CLASSES.has(cls)
      ? "real_estate"
      : /\bsaas\b|software|company|operating/i.test(blob)
        ? "operating_company"
        : "other";
  return {
    name: args.title.trim().slice(0, 120) || "Untitled asset",
    asset_type,
    current_value: parseUsdAmount(args.prompt),
  };
}
