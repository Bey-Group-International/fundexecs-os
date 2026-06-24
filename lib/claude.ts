// Claude-powered planning + execution for the AI Agent Copilot.
//
// A prompt becomes a multi-step PLAN (each step delegated to the best-fit agent),
// then each step is EXECUTED to produce a deliverable. Both use Claude.
// When ANTHROPIC_API_KEY is absent, both fall back to deterministic results
// so the app — and CI/preview builds — keep working.
import Anthropic from "@anthropic-ai/sdk";
import type { AgentKey, Hub, AssetType } from "@/lib/supabase/database.types";
import { AGENTS } from "@/lib/agents";
import { guidanceText } from "@/lib/document-quality";
import {
  deriveRouting,
  engineForStage,
  executiveForStage,
  isLifecycleStage,
  LIFECYCLE_STAGES,
  type LifecycleStage,
  type TargetEngine,
  type Executive,
} from "@/lib/intelligence";

// Default to Sonnet 4.6 for institutional-quality deliverables.
// Override with CLAUDE_MODEL env var (e.g. claude-opus-4-8 or claude-haiku-4-5-20251001).
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

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
  // Intelligence Layer: the planner classifies the lifecycle stage in the same
  // call; engine and executive are pure functions of it, so routing can't drift.
  lifecycle_stage: LifecycleStage;
  target_engine: TargetEngine;
  assigned_to: Executive;
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

// ---------------------------------------------------------------------------
// Conversational answers — Earn's chat path. When the Intelligence Layer reads
// a prompt as a question rather than a task, Earn replies directly and
// conversationally (Claude / ChatGPT / Gemini style) instead of spinning up a
// gated workflow. The chosen model is honored as a style/persona hint; the
// engine stays Claude so no extra provider keys are required.
// ---------------------------------------------------------------------------
function earnChatSystem(modelLabel: string): string {
  return (
    `You are Earn, the command layer of FundExecs OS — an AI operating system for private-market ` +
    `operators (private equity, family offices, real estate, private credit). Answer the operator's ` +
    `question directly and conversationally, like a sharp investment partner. Lead with the answer; ` +
    `be specific, practical, and numerate; prefer short paragraphs or tight bullet lists. Never ` +
    `fabricate figures — reason from stated facts and flag assumptions. If the request would be ` +
    `better executed as a multi-step workflow (sourcing, modeling, diligence, outreach, LP work), ` +
    `answer briefly and offer to run it as a workflow. Respond in the considered, well-structured ` +
    `style of ${modelLabel}.`
  );
}

// Returns a streaming message handle, or null when no API key is configured so
// the caller can fall back. Earlier turns are replayed so follow-ups build on
// the conversation.
export function earnChatStream(args: {
  body: string;
  modelLabel: string;
  priorContext?: string[];
}) {
  const anthropic = client();
  if (!anthropic) return null;
  const history = (args.priorContext ?? [])
    .slice(-6)
    .map((turn) => ({ role: "user" as const, content: turn }));
  return anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1200,
    // Cache the static persona prompt — it's identical across turns, so this
    // trims latency and cost on every reply (the planning path caches the same way).
    system: [{ type: "text", text: earnChatSystem(args.modelLabel), cache_control: { type: "ephemeral" } }],
    // Chat is latency-sensitive and rarely needs deep reasoning — keep effort low.
    output_config: { effort: "low" },
    messages: [...history, { role: "user", content: args.body }],
  });
}

const FOLLOWUPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      description: "2-3 short, specific next prompts the operator might send. Imperative or question form.",
      items: { type: "string" },
    },
  },
  required: ["suggestions"],
} as const;

// Suggested follow-ups under an answer — 2-3 next prompts. Returns [] with no
// API key so the UI simply omits them.
export async function earnFollowups(args: { body: string; reply: string }): Promise<string[]> {
  const anthropic = client();
  if (!anthropic || !args.reply.trim()) return [];
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: [
        {
          type: "text",
          text: "You are Earn inside FundExecs OS. Given the operator's question and your answer, propose 2-3 short, specific follow-up prompts they'd plausibly send next (each one line, under 8 words, no numbering).",
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: { effort: "low", format: { type: "json_schema", schema: FOLLOWUPS_SCHEMA } },
      messages: [{ role: "user", content: `Question: ${args.body}\n\nAnswer: ${args.reply}` }],
    });
    const json = textOf(message);
    if (!json) return [];
    const raw = JSON.parse(json) as { suggestions?: unknown };
    if (!Array.isArray(raw.suggestions)) return [];
    return raw.suggestions
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    console.error("[earnFollowups] Claude API error:", err);
    return [];
  }
}

// Deterministic reply when no API key is present, so the chat path still
// responds in fallback mode rather than failing.
export function earnChatFallback(body: string): string {
  return (
    `Earn is in offline mode — no model key is configured, so I can't generate a full answer right now. ` +
    `Connect ANTHROPIC_API_KEY to enable conversational responses.\n\n` +
    `You asked: "${body.trim().slice(0, 240)}"`
  );
}


const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Short title for the overall workflow" },
    hub: { type: "string", enum: HUBS },
    lifecycle_stage: {
      type: "string",
      enum: LIFECYCLE_STAGES,
      description: "The single private-markets lifecycle stage this request belongs to",
    },
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
  required: ["title", "hub", "lifecycle_stage", "summary", "steps"],
} as const;

// Multi-intent: a prompt may span several DISTINCT lifecycle stages that should
// be executed and approved independently (e.g. "underwrite the deal AND draft
// the LP update"). The planner returns 1-3 workflows; one is the common case.
const PLANS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    workflows: {
      type: "array",
      description:
        "1-3 workflows. Return ONE unless the request clearly spans different lifecycle stages that warrant separate, independently-approved workflows. Never split a single cohesive task.",
      items: PLAN_SCHEMA,
    },
  },
  required: ["workflows"],
} as const;

const PLAN_SYSTEM = `You are Earn — the command layer of FundExecs OS, an AI operating system for private-market operators (PE funds, family offices, real estate, private credit).
Given an operator's prompt, produce a concise multi-step plan. Delegate each step to the single most appropriate agent:
- analyst: deal data, pro formas, valuations, LBO/DCF models, sensitivities, underwriting
- associate: coordination, pipeline intake, drafting, general workflow management
- investor_relations: LP communications, capital calls, subscription docs, fundraising, reporting
- portfolio_ops: asset KPIs, budgets, capex variance, operational monitoring
- diligence: document parsing, data-room indexing, risk flags, IC-ready diligence memos
- fund_admin: waterfalls, fund accounting, audit prep, closing mechanics, back-office
- executive_advisor: investor research, family office intelligence, relationship targeting, pre-meeting prep
- capital_raiser: LP fundraising campaigns, founding capital circles, anchor LP pipeline, commitment tracking
- capital_connector: capital stack structuring, lender sourcing, equity partner matching, financing vehicles
- deal_sourcer: acquisition target identification, off-market sourcing, thesis-fit screening, creative financing structures
- rainmaker: prospect conversion, closing sequences, terms negotiation, commitment execution
- lead_generator: digital funnels, CRM workflows, investor capture, lead scoring, pipeline from click to conversation
- pr_director: investor decks, CIMs, executive summaries, brand positioning, PR narratives
- seo_disruptor: content strategy, thought leadership, organic authority, category-defining search presence
- curator: private investor event design, capital formation salons, room curation, relationship follow-up
Choose the hub (build/source/run/execute) that best fits the work. Keep to 2-4 steps. Titles are short and imperative.
Also classify the request into exactly one lifecycle_stage from the provided enum — the private-markets stage the work belongs to (e.g. Sourcing, Diligence, Underwriting, IC Preparation, Fundraising & LP Engagement, Compliance & Documentation, Portfolio Monitoring). This drives which execution engine the work is routed to.`;

const PLANS_SYSTEM = `${PLAN_SYSTEM}

You may return MULTIPLE workflows, but only when the operator's message clearly bundles work across DIFFERENT lifecycle stages that are best executed and approved separately — for example "underwrite the deal and draft the LP update" (Underwriting + Reporting & Communications), or "build the diligence pack, then prep the IC memo" (Diligence + IC Preparation). Each workflow must have a distinct lifecycle_stage and its summary should describe just its slice of the request.
Default to ONE workflow. Do NOT split a single cohesive task into pieces, and never return more than 3 workflows. When in doubt, return one.`;

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
  const hub = HUBS.includes(raw.hub as Hub) ? (raw.hub as Hub) : fallback.hub;
  const agents = steps.map((s) => s.agent);
  // Trust the planner's lifecycle stage when valid; otherwise classify
  // deterministically. Engine and executive are derived so they can't diverge.
  const lifecycle_stage = isLifecycleStage(raw.lifecycle_stage)
    ? raw.lifecycle_stage
    : deriveRouting({ prompt, hub, agents }).lifecycle_stage;
  return {
    title: String(raw.title ?? fallback.title).replace(/^\[.*?\]\s*/, "").trim().slice(0, 90),
    hub,
    summary: String(raw.summary ?? fallback.summary).slice(0, 240),
    steps,
    lifecycle_stage,
    target_engine: engineForStage(lifecycle_stage),
    assigned_to: executiveForStage(lifecycle_stage, agents[0] ?? "associate"),
  };
}

export async function generatePlan(
  prompt: string,
  priorContext: string[] = [],
): Promise<AgentPlan> {
  const anthropic = client();
  if (!anthropic) return fallbackPlan(prompt);
  // Earn remembers the session: earlier turns are replayed as conversation
  // history so a follow-up like "now stress the downside" builds on what came
  // before instead of being read in isolation.
  const history = priorContext
    .slice(-6)
    .map((turn) => ({ role: "user" as const, content: turn }));
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: PLAN_SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [...history, { role: "user", content: prompt }],
    });
    const json = textOf(message);
    return normalizePlan(json ? (JSON.parse(json) as AgentPlan) : null, prompt);
  } catch (err) {
    console.error("[generatePlan] Claude API error:", err);
    return fallbackPlan(prompt);
  }
}

/**
 * Normalize a multi-workflow planner response into 1-3 plans. Conservative: it
 * de-duplicates by lifecycle stage (two workflows with the same stage aren't a
 * genuine split) and falls back to a single plan when nothing valid comes back.
 */
export function normalizePlans(raw: { workflows?: unknown } | null, prompt: string): AgentPlan[] {
  const arr = raw && Array.isArray(raw.workflows) ? raw.workflows : null;
  if (!arr || arr.length === 0) return [fallbackPlan(prompt)];
  const seen = new Set<string>();
  const plans: AgentPlan[] = [];
  for (const w of arr) {
    const plan = normalizePlan(w as Partial<AgentPlan>, prompt);
    if (seen.has(plan.lifecycle_stage)) continue; // collapse same-stage duplicates
    seen.add(plan.lifecycle_stage);
    plans.push(plan);
    if (plans.length === 3) break; // hard cap
  }
  return plans.length ? plans : [fallbackPlan(prompt)];
}

/**
 * Plan a prompt into one OR MORE workflows. Returns a single plan in the common
 * case; multiple only when the request spans distinct lifecycle stages. Holds in
 * fallback mode (no API key) by returning a single deterministic plan.
 */
export async function generatePlans(
  prompt: string,
  priorContext: string[] = [],
): Promise<AgentPlan[]> {
  const anthropic = client();
  if (!anthropic) return [fallbackPlan(prompt)];
  const history = priorContext
    .slice(-6)
    .map((turn) => ({ role: "user" as const, content: turn }));
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: PLANS_SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low", format: { type: "json_schema", schema: PLANS_SCHEMA } },
      messages: [...history, { role: "user", content: prompt }],
    });
    const json = textOf(message);
    return normalizePlans(json ? (JSON.parse(json) as { workflows?: unknown }) : null, prompt);
  } catch (err) {
    console.error("[generatePlans] Claude API error:", err);
    return [fallbackPlan(prompt)];
  }
}

const QUESTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      description: "0-3 short clarifying questions. Empty if the request is already clear.",
      items: { type: "string" },
    },
  },
  required: ["questions"],
} as const;

// Earn asks the operator: surface the few things it genuinely needs to know to
// complete the work well. Returns [] when the request is clear — or when there's
// no API key, so fallback mode never blocks the loop.
export async function generateClarifyingQuestions(prompt: string): Promise<string[]> {
  const anthropic = client();
  if (!anthropic) return [];
  const CLARIFY_SYSTEM =
    "You are Earn, the command layer of FundExecs OS. Before executing an operator's request, ask only the clarifying questions that materially change the work (scope, constraints, targets, definitions). Ask nothing if the request is already actionable. Never ask more than 3. Keep each question to one short sentence.";
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: [{ type: "text", text: CLARIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low", format: { type: "json_schema", schema: QUESTIONS_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    const json = textOf(message);
    if (!json) return [];
    const raw = JSON.parse(json) as { questions?: unknown };
    if (!Array.isArray(raw.questions)) return [];
    return raw.questions
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    console.error("[generateClarifyingQuestions] Claude API error:", err);
    return [];
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
  } catch (err) {
    console.error("[executeStep] Claude API error:", err);
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
      system: [{ type: "text", text: EXTRACT_SYSTEM, cache_control: { type: "ephemeral" } }],
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
  } catch (err) {
    console.error("[extractDealFields] Claude API error:", err);
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
      system: [{ type: "text", text: EXTRACT_SYSTEM, cache_control: { type: "ephemeral" } }],
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
      current_value: cleanNum(raw.current_value) ?? fb.current_value,
    };
  } catch (err) {
    console.error("[extractAssetFields] Claude API error:", err);
    return fallbackAssetFields(args);
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallbacks (no API key) — keep the loop demoable everywhere.
// ---------------------------------------------------------------------------
function fallbackPlan(prompt: string): AgentPlan {
  // Strip any operator-context prefix ("[The operator is working in ...]") that
  // the client prepends to the body before it reaches the engine. This prefix
  // must never surface in plan titles or session names.
  const cleanPrompt = prompt.replace(/^\[[\s\S]*?\]\s*/, "").trim();
  const t = cleanPrompt.toLowerCase();
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
  const det = deriveRouting({ prompt, hub, agents: steps.map((s) => s.agent) });
  return {
    title: cleanPrompt.slice(0, 80) || "Workflow",
    hub,
    summary: "Planned by the Associate.",
    steps,
    lifecycle_stage: det.lifecycle_stage,
    target_engine: det.target_engine,
    assigned_to: det.assigned_to,
  };
}

function fallbackStepOutput(args: { stepTitle: string; agent: AgentKey }): string {
  const agentName = AGENTS.find((a) => a.key === args.agent)?.name ?? args.agent;
  return `[${agentName}] Completed: ${args.stepTitle}. (Connect ANTHROPIC_API_KEY for a full AI-generated deliverable.)`;
}

// Parse the first plausible USD figure ("$25M", "12.5 million", "$3,000,000").
// Requires an explicit currency cue — a "$", a magnitude word, or "usd"/"dollars" —
// so bare numbers (years, counts) aren't misread as monetary amounts.
function parseUsdAmount(text: string): number | null {
  const m = text.match(
    /\$\s*([\d,]+(?:\.\d+)?)\s*(k|m|mm|bn?|thousand|million|billion)?\b|([\d,]+(?:\.\d+)?)\s*(k|m|mm|bn?|thousand|million|billion|usd|dollars?)\b/i,
  );
  if (!m) return null;
  const base = Number((m[1] ?? m[3]).replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;
  const unit = (m[2] ?? m[4] ?? "").toLowerCase();
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

// ---------------------------------------------------------------------------
// Entity ownership extraction — Earn drafts a cap table for a firm vehicle from
// a plain-language description. Deterministic regex fallback when no API key.
// ---------------------------------------------------------------------------
export interface OwnershipDraftRow {
  stakeholder: string;
  kind: string;
  share_class: string | null;
  ownership_pct: number | null;
  units: number | null;
}

const OWNERSHIP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      description: "One row per stakeholder/holder named in the description.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stakeholder: { type: "string", description: "Holder name" },
          kind: { type: "string", enum: ["person", "entity", "investor", "fund", "pool", "other"] },
          share_class: { type: ["string", "null"], description: "e.g. Common, GP interest, Option pool" },
          ownership_pct: { type: ["number", "null"], description: "Ownership percentage if stated" },
          units: { type: ["number", "null"], description: "Unit/share count if stated" },
        },
        required: ["stakeholder", "kind", "share_class", "ownership_pct", "units"],
      },
    },
  },
  required: ["rows"],
} as const;

function fallbackOwnership(description: string): OwnershipDraftRow[] {
  const rows: OwnershipDraftRow[] = [];
  const re = /([A-Za-z][\w&.'\- ]{1,60}?)\s*[—:\-–]?\s*(\d{1,3}(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    const name = m[1].trim().replace(/\s+/g, " ");
    const pct = Number(m[2]);
    if (name && Number.isFinite(pct)) {
      rows.push({ stakeholder: name, kind: /pool|option/i.test(name) ? "pool" : "person", share_class: null, ownership_pct: pct, units: null });
    }
  }
  return rows;
}

export async function extractOwnership(args: {
  description: string;
  entityName: string;
}): Promise<OwnershipDraftRow[]> {
  const anthropic = client();
  if (!anthropic) return fallbackOwnership(args.description);
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        `Extract the ownership/cap-table of the firm vehicle "${args.entityName}" from the description. ` +
        `Return rows of holders with ownership % and/or units and a share class where stated. ` +
        `Do not invent holders or numbers; omit what isn't stated.`,
      output_config: { effort: "low", format: { type: "json_schema", schema: OWNERSHIP_SCHEMA } },
      messages: [{ role: "user", content: args.description }],
    });
    const json = textOf(message);
    if (!json) return fallbackOwnership(args.description);
    const parsed = JSON.parse(json) as { rows?: OwnershipDraftRow[] };
    return Array.isArray(parsed.rows) ? parsed.rows : fallbackOwnership(args.description);
  } catch (err) {
    console.error("[extractOwnership] Claude API error:", err);
    return fallbackOwnership(args.description);
  }
}

// ---------------------------------------------------------------------------
// Conversational document drafting — the Earn mode in the data-room builder.
// Earn drafts/revises a document through chat, grounded in the firm's data.
// Returns a short reply plus the full revised document content (markdown).
// Falls back to keeping the current draft when no API key is configured.
// ---------------------------------------------------------------------------
export interface DraftTurn {
  role: "user" | "assistant";
  content: string;
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "A short chat reply to the user (1-3 sentences)." },
    content: {
      type: "string",
      description: "The FULL revised document in markdown — the complete draft so far, not a diff.",
    },
  },
  required: ["reply", "content"],
} as const;

export async function conversationalDraft(args: {
  docName: string;
  section: string;
  currentContent: string;
  foundation: string;
  messages: DraftTurn[];
}): Promise<{ reply: string; content: string }> {
  const anthropic = client();
  if (!anthropic) {
    return {
      reply:
        "Earn is offline (no API key configured), so I kept your current draft. You can still write it manually or compose from your data.",
      content: args.currentContent,
    };
  }
  const system =
    `You are Earn, drafting an institutional "${args.docName}" (data-room section: ${args.section}) ` +
    `for a private-markets firm being read by an allocator's diligence team. Write in a precise, ` +
    `institutional voice; lead with the outcome; be specific and verifiable. Ground everything in the ` +
    `firm context below — never invent facts; leave a clearly marked [TODO] where information is missing.\n\n` +
    `=== Institutional structure to follow ===\n${guidanceText(args.docName, args.section)}\n\n` +
    `=== Firm context ===\n${args.foundation || "(no firm data yet)"}\n\n` +
    `=== Current draft ===\n${args.currentContent || "(empty)"}\n\n` +
    `Each turn, return JSON {reply, content} where content is the COMPLETE revised markdown document.`;
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system,
      output_config: { effort: "medium", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      messages: args.messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    });
    const json = textOf(message);
    if (!json) return { reply: "I couldn't draft that — try rephrasing.", content: args.currentContent };
    const parsed = JSON.parse(json) as { reply?: string; content?: string };
    return {
      reply: parsed.reply?.trim() || "Updated the draft.",
      content: typeof parsed.content === "string" ? parsed.content : args.currentContent,
    };
  } catch (err) {
    console.error("[conversationalDraft] Claude API error:", err);
    return { reply: "Something went wrong drafting that. Your draft is unchanged.", content: args.currentContent };
  }
}
