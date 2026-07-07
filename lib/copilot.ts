// The Earn copilot's brain: turns the operator's current location in the app
// into (1) the specialist agent who should be "on point", and (2) a short set
// of context-aware next-best actions Earn can launch on their behalf. Pure and
// dependency-light so it is trivially unit-testable and safe to import from
// client components.
import type { AgentKey, Hub } from "@/lib/supabase/database.types";
import { tierForAction, gateDecision, type ActionKind, type GateTier, type Mandate } from "@/lib/gates";

export interface CopilotContext {
  hub: Hub | null;
  module: string | null;
  dealId: string | null;
  /** A stable key for the location, e.g. "run/diligence", "deal", "dashboard". */
  scope: string;
}

export interface CopilotSuggestion {
  id: string;
  /** Button label shown in the dock. */
  label: string;
  /** One-line description of what Earn will do. */
  hint: string;
  /** The pre-baked prompt handed to the engine when launched. */
  prompt: string;
  /** Which specialist this routes to (badge + framing). */
  agent: AgentKey;
  /** If this is an outward action, its gate kind — drives the approval badge. */
  action?: ActionKind;
}

const HUBS: Hub[] = ["build", "source", "run", "execute"];

/**
 * Parse the current pathname into a copilot context. Recognizes the hub/module
 * routes, the deal war room, and a few app-level surfaces; everything else
 * falls back to a generic workspace scope where Earn fronts alone.
 */
export function copilotContextFromPath(pathname: string): CopilotContext {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);

  // /deal/[id] — the deal war room (Run-flavored context).
  if (parts[0] === "deal" && parts[1]) {
    return { hub: "run", module: "deal", dealId: parts[1], scope: "deal" };
  }

  // /session/[id]/[hub]/[module] — work opened inside a session frame.
  if (parts[0] === "session" && parts[2] && HUBS.includes(parts[2] as Hub)) {
    return {
      hub: parts[2] as Hub,
      module: parts[3] ?? null,
      dealId: null,
      scope: parts[3] ? `${parts[2]}/${parts[3]}` : (parts[2] as string),
    };
  }

  // /[hub] or /[hub]/[module]
  if (HUBS.includes(parts[0] as Hub)) {
    const hub = parts[0] as Hub;
    const mod = parts[1] ?? null;
    return { hub, module: mod, dealId: null, scope: mod ? `${hub}/${mod}` : hub };
  }

  return { hub: null, module: null, dealId: null, scope: parts[0] ?? "workspace" };
}

// Which specialist is on point for a given module. Falls back to a hub default,
// then to Earn (the "associate") when there is no hub context.
const MODULE_AGENT: Record<string, AgentKey> = {
  // Run
  "run/strategy": "analyst",
  "run/diligence": "diligence",
  "run/underwriting": "analyst",
  "run/stress_test": "analyst",
  "run/risk": "diligence",
  deal: "diligence",
  // Source
  "source/lp_pipeline": "capital_raiser",
  "source/deal_pipeline": "deal_sourcer",
  "source/partners": "capital_connector",
  "source/providers": "executive_advisor",
  "source/debt": "capital_raiser",
  // Execute
  "execute/closing": "fund_admin",
  "execute/capital_events": "fund_admin",
  "execute/asset_management": "portfolio_ops",
  "execute/reporting": "investor_relations",
  "execute/exit": "portfolio_ops",
  // Build
  "build/profile": "pr_director",
  "build/brand": "pr_director",
  "build/materials": "pr_director",
  "build/thesis": "curator",
  "build/track_record": "curator",
  "build/team": "curator",
  "build/entity": "curator",
};

const HUB_DEFAULT_AGENT: Record<Hub, AgentKey> = {
  build: "curator",
  source: "executive_advisor",
  run: "analyst",
  execute: "portfolio_ops",
};

/** The specialist agent who should front the copilot in this context. */
export function onPointAgent(ctx: CopilotContext): AgentKey {
  if (ctx.scope && MODULE_AGENT[ctx.scope]) return MODULE_AGENT[ctx.scope];
  if (ctx.hub) return HUB_DEFAULT_AGENT[ctx.hub];
  return "associate";
}

// Pre-baked, context-aware suggestions. Keyed by scope; a hub-level fallback
// covers hub landings, and a generic set covers the workspace/dashboard.
const SUGGESTIONS: Record<string, CopilotSuggestion[]> = {
  "run/diligence": [
    {
      id: "dd-checklist",
      label: "Build the diligence checklist",
      hint: "Earn drafts a standard DD checklist for the deal you pick.",
      prompt:
        "Build a thorough due-diligence checklist for our active deal, organized by category (legal, financial, commercial, tax, operational), and add the items so we can work them.",
      agent: "diligence",
    },
    {
      id: "dd-findings",
      label: "Summarize open findings",
      hint: "A risk-ranked summary of what's still open across deals.",
      prompt:
        "Review our open diligence items across the active pipeline and summarize the most decision-blocking findings, ranked by severity, with a recommended path to clear each.",
      agent: "diligence",
    },
  ],
  "run/underwriting": [
    {
      id: "uw-base",
      label: "Draft a base-case model",
      hint: "The Analyst frames a base/upside/downside underwriting.",
      prompt:
        "Draft a base, upside, and downside underwriting for our active deal with projected IRR and MOIC, and lay out the key assumptions behind each scenario.",
      agent: "analyst",
    },
    {
      id: "uw-stress",
      label: "Stress the downside",
      hint: "Pressure-test where the deal breaks.",
      prompt:
        "Stress-test our active deal's downside: what level of rent/exit/rate shock breaks the equity return, and how much cushion does the base case carry?",
      agent: "analyst",
    },
  ],
  "run/strategy": [
    {
      id: "strat-fit",
      label: "Score mandate fit",
      hint: "Rank live deals against your thesis.",
      prompt:
        "Score each of our live deals against our investment mandate (asset class, geography, return target) and tell me which to prioritize and which to drop.",
      agent: "analyst",
    },
  ],
  "run/risk": [
    {
      id: "risk-register",
      label: "Refresh the risk register",
      hint: "Consolidate and rank open risks across deals.",
      prompt:
        "Consolidate the open risks across our active deals into a single register ranked by residual severity, and propose a mitigation for each high or critical item.",
      agent: "diligence",
    },
  ],
  "source/lp_pipeline": [
    {
      id: "lp-targets",
      label: "Find LP targets",
      hint: "Capital Raiser proposes LPs that fit the raise.",
      prompt:
        "Propose a ranked list of prospective LPs that fit our mandate and check size, with the rationale and best entry approach for each.",
      agent: "capital_raiser",
      action: "build_list",
    },
    {
      id: "lp-outreach",
      label: "Draft LP outreach",
      hint: "A tailored first-touch for a prospect.",
      prompt:
        "Draft a tailored, credible first-touch outreach to our top prospective LP, grounded in our thesis and track record.",
      agent: "capital_raiser",
      action: "draft_message",
    },
  ],
  "source/deal_pipeline": [
    {
      id: "deal-source",
      label: "Source new deals",
      hint: "Deal Sourcer surfaces opportunities on-thesis.",
      prompt:
        "Source new deal opportunities that fit our mandate (asset class, geography, check size) and add the most promising to our pipeline with a fit rationale.",
      agent: "deal_sourcer",
      action: "build_list",
    },
  ],
  "execute/reporting": [
    {
      id: "lp-update",
      label: "Draft the LP update",
      hint: "IR drafts the quarterly from the operating record.",
      prompt:
        "Draft our quarterly LP update from the current portfolio: NAV, capital called and returned, the standard multiples (TVPI/DPI/MOIC), and a concise note per asset.",
      agent: "investor_relations",
      action: "draft_memo",
    },
  ],
  "execute/capital_events": [
    {
      id: "cap-call",
      label: "Prepare a capital call",
      hint: "Fund Admin assembles the call across LPs.",
      prompt:
        "Prepare a capital call: compute each LP's pro-rata amount against their commitment and draft the call notices for review.",
      agent: "fund_admin",
      action: "distribute_report",
    },
  ],
  "build/thesis": [
    {
      id: "thesis-draft",
      label: "Draft the thesis",
      hint: "Earn frames an institutional investment thesis.",
      prompt:
        "Draft a concise institutional investment thesis for our firm: target asset classes, geographies, check-size range, and target returns, grounded in our profile and track record.",
      agent: "curator",
    },
  ],
};

const HUB_FALLBACK: Record<Hub, CopilotSuggestion[]> = {
  build: [
    {
      id: "build-foundation",
      label: "Strengthen the foundation",
      hint: "Earn finds the next highest-leverage gap in your profile.",
      prompt:
        "Review our firm foundation (profile, thesis, brand, track record, team) and tell me the single highest-leverage thing to complete next, then draft it.",
      agent: "curator",
    },
  ],
  source: [
    {
      id: "source-next",
      label: "Advance the pipeline",
      hint: "Find the next-best move across LPs and deals.",
      prompt:
        "Look across our LP and deal pipelines and tell me the next-best action to advance the raise this week, then take the first step.",
      agent: "executive_advisor",
    },
  ],
  run: [
    {
      id: "run-next",
      label: "Push the strongest deal",
      hint: "Surface the closest-to-IC deal and what it needs.",
      prompt:
        "Across our deals in evaluation, which is closest to IC-ready and what is the single thing standing in the way? Take the first step to close that gap.",
      agent: "analyst",
    },
  ],
  execute: [
    {
      id: "execute-next",
      label: "Check the portfolio",
      hint: "Surface the most pressing operating signal.",
      prompt:
        "Review our portfolio's operating record and surface the most pressing signal — a mark, a capital event, or a reporting deadline — then prepare the first step.",
      agent: "portfolio_ops",
    },
  ],
};

const GENERIC: CopilotSuggestion[] = [
  {
    id: "whats-next",
    label: "What should I do next?",
    hint: "Earn reads your firm's state and recommends the next move.",
    prompt:
      "Look across our whole operation — foundation, raise, live deals, and portfolio — and tell me the single highest-leverage thing to do next, then take the first step.",
    agent: "associate",
  },
];

/** The context-aware suggestions to show in the dock for a given location. */
export function suggestionsFor(ctx: CopilotContext): CopilotSuggestion[] {
  if (ctx.scope && SUGGESTIONS[ctx.scope]) return SUGGESTIONS[ctx.scope];
  if (ctx.hub && HUB_FALLBACK[ctx.hub]) return HUB_FALLBACK[ctx.hub];
  return GENERIC;
}

/** The gate tier for a suggestion that performs an outward action (else null). */
export function suggestionTier(s: CopilotSuggestion): GateTier | null {
  return s.action ? tierForAction(s.action) : null;
}

/**
 * Whether Earn will run this suggestion immediately vs. parking it for the
 * operator's approval. Suggestions with no outward action are internal Tier-1
 * work product and always run; outward ones run only when the standing mandate
 * pre-authorizes them (Tier 2 within ceiling). Tier 3 never auto-runs.
 */
export function willAutoRun(s: CopilotSuggestion, mandate?: Mandate): boolean {
  if (!s.action) return true;
  return !gateDecision(s.action, mandate).requiresApproval;
}

/**
 * Build the context preamble prepended to a free-form "ask Earn" message, so the
 * engine plans against where the operator actually is.
 */
export function contextPreamble(ctx: CopilotContext): string {
  const where = ctx.dealId
    ? `the deal war room (deal ${ctx.dealId})`
    : ctx.module && ctx.hub
      ? `${ctx.hub} › ${ctx.module.replace(/_/g, " ")}`
      : ctx.hub
        ? `the ${ctx.hub} hub`
        : "the workspace";
  return `[The operator is working in ${where}.]`;
}
