// The Intelligence Layer of FundExecs OS.
//
// Sits in front of the task engine: it interprets an operator's message,
// classifies intent across the private-markets lifecycle, and routes the work
// to the correct execution engine and AI executive. The output is a single
// structured ROUTING OBJECT that is persisted alongside the plan (audit trail)
// and recomputed client-side to render the Cursor-style response.
//
// Everything here is deterministic and pure (no DB, no network) so it behaves
// identically on the server and in the browser, and holds in fallback mode
// (no ANTHROPIC_API_KEY) — the engine never depends on a model call to route.
import type { AgentKey, Hub } from "@/lib/supabase/database.types";

// --- Taxonomy -------------------------------------------------------------

// Lifecycle stages span the fund and deal lifecycles, plus the cross-lifecycle
// operations bucket (workflow automation, orchestration).
export type LifecycleStage =
  // Fund lifecycle
  | "Fund Strategy"
  | "Mandate Definition"
  | "Market Mapping"
  | "Capital Stack Design"
  | "Fundraising & LP Engagement"
  | "Compliance & Documentation"
  | "Portfolio Construction"
  | "Reporting & Communications"
  // Deal lifecycle
  | "Sourcing"
  | "Screening"
  | "Diligence"
  | "Underwriting"
  | "IC Preparation"
  | "Structuring"
  | "Closing"
  | "Portfolio Monitoring"
  | "Exit Planning"
  // Cross-lifecycle
  | "Workflow Automation";

// The seven panes of the Execution Grid (section 8). `target_engine` is always
// one of these so a routed task lands in exactly one pane.
export type TargetEngine =
  | "Mandate Engine"
  | "Outbound Engine"
  | "Relationship Graph"
  | "Diligence Engine"
  | "Capital Stack Engine"
  | "Workflow Builder"
  | "Reporting Engine";

// The AI executive team (section 7). The codebase ships fifteen native agents;
// these six executives are the orchestration layer above them.
export type Executive = "earn_coo" | "cio" | "analyst" | "associate" | "cmo" | "cro";

export const EXECUTIVE_LABEL: Record<Executive, string> = {
  earn_coo: "COO.AI (Earn)",
  cio: "CIO.AI",
  analyst: "Analyst.AI",
  associate: "Associate.AI",
  cmo: "CMO.AI",
  cro: "CRO.AI",
};

// Each lifecycle stage lands in exactly one Execution Grid pane. Engine is a
// pure function of stage so the planner (LLM) and the deterministic fallback
// can never disagree on where the work belongs.
export const STAGE_TO_ENGINE: Record<LifecycleStage, TargetEngine> = {
  "Fund Strategy": "Mandate Engine",
  "Mandate Definition": "Mandate Engine",
  "Market Mapping": "Relationship Graph",
  "Capital Stack Design": "Capital Stack Engine",
  "Fundraising & LP Engagement": "Outbound Engine",
  "Compliance & Documentation": "Diligence Engine",
  "Portfolio Construction": "Capital Stack Engine",
  "Reporting & Communications": "Reporting Engine",
  Sourcing: "Outbound Engine",
  Screening: "Outbound Engine",
  Diligence: "Diligence Engine",
  Underwriting: "Capital Stack Engine",
  "IC Preparation": "Reporting Engine",
  Structuring: "Capital Stack Engine",
  Closing: "Capital Stack Engine",
  "Portfolio Monitoring": "Reporting Engine",
  "Exit Planning": "Reporting Engine",
  "Workflow Automation": "Workflow Builder",
};

// Enumerations — used for JSON-schema enums (the planner) and runtime validation.
export const LIFECYCLE_STAGES = Object.keys(STAGE_TO_ENGINE) as LifecycleStage[];
export const TARGET_ENGINES = Array.from(new Set(Object.values(STAGE_TO_ENGINE))) as TargetEngine[];
export const EXECUTIVES = Object.keys(EXECUTIVE_LABEL) as Executive[];

export function isLifecycleStage(v: unknown): v is LifecycleStage {
  return typeof v === "string" && v in STAGE_TO_ENGINE;
}
export function isTargetEngine(v: unknown): v is TargetEngine {
  return typeof v === "string" && (TARGET_ENGINES as string[]).includes(v);
}
export function isExecutive(v: unknown): v is Executive {
  return typeof v === "string" && v in EXECUTIVE_LABEL;
}

export function engineForStage(stage: LifecycleStage): TargetEngine {
  return STAGE_TO_ENGINE[stage];
}

// Stages that route to CRO regardless of the drafting agent.
const COMPLIANCE_STAGES = new Set<LifecycleStage>(["Compliance & Documentation"]);

export interface RoutingPayload {
  entities: string[];
  request: string;
  parameters: Record<string, unknown>;
  priority: "low" | "normal" | "high";
  tags: string[];
}

// Whether routing came from a positive classification (a RULES match or an
// explicitly classified stage) or fell back to a hub default. `low` rows are
// surfaced for human review.
export type RoutingConfidence = "high" | "low";

// The structured internal object (section 6). Persisted on prompts.parsed_intent.
export interface RoutingObject {
  intent: string;
  lifecycle_stage: LifecycleStage;
  target_engine: TargetEngine;
  assigned_to: Executive;
  payload: RoutingPayload;
  confidence: RoutingConfidence;
  status: "routed";
}

// --- Executive mapping (the "mapping layer") ------------------------------
//
// Reconciles the fifteen native agents onto the six executives by FUNCTION, not
// by name. Note: the agent literally named "Analyst" does modeling/underwriting
// (CIO domain); the "Diligence" agent does research/data-extraction (Analyst.AI
// domain). Compliance/risk work is routed to CRO at the stage level below,
// regardless of agent, so all six executives stay reachable.
const AGENT_TO_EXECUTIVE: Record<AgentKey, Executive> = {
  // Modeling, underwriting, capital structure → CIO
  analyst: "cio",
  capital_connector: "cio",
  // Research, diligence, sourcing intelligence, data extraction → Analyst
  diligence: "analyst",
  deal_sourcer: "analyst",
  executive_advisor: "analyst",
  // Drafting, structuring, IC prep, coordination → Associate
  associate: "associate",
  // Capital formation, LP engagement, outbound, messaging → CMO
  investor_relations: "cmo",
  capital_raiser: "cmo",
  rainmaker: "cmo",
  lead_generator: "cmo",
  pr_director: "cmo",
  seo_disruptor: "cmo",
  curator: "cmo",
  // Operations, back-office, orchestration → COO (Earn)
  portfolio_ops: "earn_coo",
  fund_admin: "earn_coo",
};

export function executiveForAgent(agent: AgentKey): Executive {
  return AGENT_TO_EXECUTIVE[agent] ?? "earn_coo";
}

// Compliance/risk work is CRO's regardless of which agent drafts it; otherwise
// the executive follows the primary agent. Single rule, reused everywhere.
export function executiveForStage(stage: LifecycleStage, primaryAgent: AgentKey): Executive {
  return COMPLIANCE_STAGES.has(stage) ? "cro" : executiveForAgent(primaryAgent);
}

// --- Delegate & Route -----------------------------------------------------
//
// The operator can override Earn's auto-routing and DELEGATE a request to a
// specific executive desk. Because `assigned_to` is a pure function of the
// primary agent (and stage), delegating is just repointing the primary agent to
// a representative of that desk — and, for CRO (which has no native agent and is
// only reachable structurally), forcing a compliance stage.
export const DESK_PRIMARY_AGENT: Record<Executive, AgentKey> = {
  earn_coo: "portfolio_ops",
  cio: "analyst",
  analyst: "diligence",
  associate: "associate",
  cmo: "investor_relations",
  // CRO is reached via a compliance stage; the agent only seeds the step.
  cro: "associate",
};

// Desks that can only be reached by pinning a particular lifecycle stage.
export const DESK_FORCE_STAGE: Partial<Record<Executive, LifecycleStage>> = {
  cro: "Compliance & Documentation",
};

export interface DeskOverride {
  primaryAgent: AgentKey;
  // When the desk forces a stage (CRO), the stage/engine to pin; else null.
  stage: LifecycleStage | null;
  engine: TargetEngine | null;
}

// The concrete routing changes that delegating to `desk` implies. Pure.
export function deskOverride(desk: Executive): DeskOverride {
  const stage = DESK_FORCE_STAGE[desk] ?? null;
  return {
    primaryAgent: DESK_PRIMARY_AGENT[desk],
    stage,
    engine: stage ? engineForStage(stage) : null,
  };
}

// --- Classification rules -------------------------------------------------
//
// Ordered; first match wins. Mirrors the spec's Routing Rules (section 2). Each
// rule fixes the lifecycle stage and the destination engine; the executive is
// derived from the plan's primary agent, then overridden for compliance/risk.
interface Rule {
  test: RegExp;
  stage: LifecycleStage;
  engine: TargetEngine;
  tag: string;
}

const RULES: Rule[] = [
  { test: /\b(mandate|investment thesis|refine (the )?strategy|fund strategy|strategy memo)\b/i, stage: "Mandate Definition", engine: "Mandate Engine", tag: "mandate" },
  { test: /\b(find|build|grow|source)\b.*\b(lp|lps|investor|investors|allocator|family office|capital)\b|\b(lp|investor) (pipeline|outreach|engagement)\b|\bfundrais/i, stage: "Fundraising & LP Engagement", engine: "Outbound Engine", tag: "lp_engagement" },
  { test: /\b(relationship|network|warm intro|graph|map (the )?(market|relationships)|connector)\b/i, stage: "Market Mapping", engine: "Relationship Graph", tag: "relationship" },
  { test: /\b(diligence|due dilig|data ?room|red flag|risk flag|qoe|quality of earnings)\b/i, stage: "Diligence", engine: "Diligence Engine", tag: "diligence" },
  { test: /\b(capital stack|debt|equity|financing|lender|leverage|mezz|senior|tranche)\b/i, stage: "Capital Stack Design", engine: "Capital Stack Engine", tag: "capital_stack" },
  { test: /\b(ic memo|investment committee|ic prep|ic-ready|recommendation memo)\b/i, stage: "IC Preparation", engine: "Reporting Engine", tag: "ic_prep" },
  { test: /\b(underwrit|lbo|dcf|valuation|pro ?forma|sensitivit|irr|moic|model)\b/i, stage: "Underwriting", engine: "Capital Stack Engine", tag: "underwriting" },
  { test: /\b(compliance|regulat|kyc|aml|audit|legal review|subscription doc|side letter)\b/i, stage: "Compliance & Documentation", engine: "Diligence Engine", tag: "compliance" },
  { test: /\b(automat|workflow|recurring|schedule|every (day|week|month)|pipeline of tasks)\b/i, stage: "Workflow Automation", engine: "Workflow Builder", tag: "workflow" },
  { test: /\b(report|summar|performance|portfolio (update|report)|lp update|distribution notice)\b/i, stage: "Reporting & Communications", engine: "Reporting Engine", tag: "reporting" },
  { test: /\b(portfolio|monitor|kpi|asset management|variance|budget)\b/i, stage: "Portfolio Monitoring", engine: "Reporting Engine", tag: "monitoring" },
  { test: /\b(clos(e|ing)|escrow|wire|sign(ing)?|fund the deal|definitive agreement)\b/i, stage: "Closing", engine: "Capital Stack Engine", tag: "closing" },
  { test: /\b(structur)\w*/i, stage: "Structuring", engine: "Capital Stack Engine", tag: "structuring" },
  { test: /\b(exit|divest|sell|sale process|trade sale|secondary)\b/i, stage: "Exit Planning", engine: "Reporting Engine", tag: "exit" },
  { test: /\b(screen|shortlist|score|rank).*\b(deal|target|candidate)\b|\bscreening\b/i, stage: "Screening", engine: "Outbound Engine", tag: "screening" },
  { test: /\b(sourc|pipeline|target|acqui|deal flow|off-?market)\b/i, stage: "Sourcing", engine: "Outbound Engine", tag: "sourcing" },
];

// Hub-level defaults when no rule matches — keeps routing total.
const HUB_DEFAULT: Record<Hub, { stage: LifecycleStage; engine: TargetEngine }> = {
  build: { stage: "Fund Strategy", engine: "Mandate Engine" },
  source: { stage: "Sourcing", engine: "Outbound Engine" },
  run: { stage: "Diligence", engine: "Diligence Engine" },
  execute: { stage: "Reporting & Communications", engine: "Reporting Engine" },
};

// Light, non-hallucinating entity scan: quoted names, $ amounts, and runs of
// Capitalized Words (proper nouns). Returns a small, de-duplicated set.
function extractEntities(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/"([^"]{2,60})"/g)) out.add(m[1].trim());
  for (const m of text.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|mm|bn?|thousand|million|billion)?/gi)) out.add(m[0].trim());
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9&.'-]+(?:\s+[A-Z][a-zA-Z0-9&.'-]+){0,3})\b/g)) {
    const v = m[1].trim();
    // Drop single short words and leading-sentence noise — keep multi-word names.
    if (v.includes(" ") && v.length <= 60) out.add(v);
  }
  return Array.from(out).slice(0, 8);
}

export interface RoutingInput {
  prompt: string;
  hub: Hub;
  // Agents drawn from the plan's steps; the first is treated as primary.
  agents: AgentKey[];
}

function makePayload(prompt: string, hub: Hub, agents: AgentKey[], tag: string): RoutingPayload {
  const priority: RoutingPayload["priority"] = /\b(urgent|asap|today|immediately|by (eod|tomorrow))\b/i.test(
    prompt,
  )
    ? "high"
    : "normal";
  return {
    entities: extractEntities(prompt),
    request: prompt.slice(0, 2000),
    parameters: {},
    priority,
    tags: Array.from(new Set([hub, tag, ...agents.map(String)])).slice(0, 8),
  };
}

/**
 * Assemble the structured routing object from an EXPLICIT lifecycle stage — the
 * authoritative path. The planner (LLM) chooses the stage; the engine is a pure
 * function of it and the executive follows the primary agent (CRO for
 * compliance). Used by the engine so persisted routing matches the plan exactly.
 */
export function buildRouting(input: {
  prompt: string;
  hub: Hub;
  agents: AgentKey[];
  stage: LifecycleStage;
}): RoutingObject {
  const stage = input.stage;
  const primaryAgent = input.agents[0] ?? "associate";
  return {
    intent: stage,
    lifecycle_stage: stage,
    target_engine: engineForStage(stage),
    assigned_to: executiveForStage(stage, primaryAgent),
    payload: makePayload(input.prompt.trim(), input.hub, input.agents, stage),
    // The stage was explicitly classified (by the planner), so this is authoritative.
    confidence: "high",
    status: "routed",
  };
}

/**
 * Classify a prompt into the structured routing object DETERMINISTICALLY. This
 * is the fallback (no API key) and the validator behind the planner: the same
 * input always routes the same way.
 */
export function deriveRouting(input: RoutingInput): RoutingObject {
  const prompt = input.prompt.trim();
  const matched = RULES.find((r) => r.test.test(prompt));
  const stage = (matched ?? HUB_DEFAULT[input.hub]).stage;
  const tag = matched?.tag ?? input.hub;
  return {
    intent: stage,
    lifecycle_stage: stage,
    target_engine: engineForStage(stage),
    assigned_to: executiveForStage(stage, input.agents[0] ?? "associate"),
    payload: makePayload(prompt, input.hub, input.agents, tag),
    // High when a rule matched; low when we fell back to the hub default.
    confidence: matched ? "high" : "low",
    status: "routed",
  };
}

/**
 * Reconstruct a routing object for the UI from a workflow's PERSISTED columns,
 * falling back to deterministic classification for rows written before routing
 * was persisted. Keeps server routing and client rendering in lockstep.
 */
export function routingFromTask(input: {
  prompt: string;
  hub: Hub;
  agents: AgentKey[];
  stage: string | null;
}): RoutingObject {
  if (isLifecycleStage(input.stage)) {
    return buildRouting({ prompt: input.prompt, hub: input.hub, agents: input.agents, stage: input.stage });
  }
  return deriveRouting({ prompt: input.prompt, hub: input.hub, agents: input.agents });
}

// --- Cursor-style response (section 4) ------------------------------------
//
// Summary / Action / Output / Next Step. The Output section is rendered by the
// caller (the live step lanes); this returns the surrounding copy.
export interface CursorResponse {
  summary: string;
  action: string;
  nextStep: string;
}

export function cursorResponse(
  routing: RoutingObject,
  opts: { pending: boolean; stepCount: number },
): CursorResponse {
  const exec = EXECUTIVE_LABEL[routing.assigned_to];
  return {
    summary: `Read as a ${routing.lifecycle_stage} request.`,
    action: `Routed to the ${routing.target_engine} · ${exec} across ${opts.stepCount} step${opts.stepCount === 1 ? "" : "s"}.`,
    nextStep: opts.pending
      ? "Approve to automate, accept the recommendation, or refine the plan."
      : "Review the deliverables below.",
  };
}

// One-line headline for compact badges: "Diligence → Diligence Engine · Analyst.AI".
export function routingHeadline(routing: RoutingObject): string {
  return `${routing.lifecycle_stage} → ${routing.target_engine} · ${EXECUTIVE_LABEL[routing.assigned_to]}`;
}
