// lib/executives/registry.ts
// The operational executive capability registry — the governance overlay that
// maps FundExecs' executive team to BOUNDED OPERATIONAL DOMAINS. Pure + tested.
//
// This does NOT introduce a competing execution taxonomy: the engine still runs
// the 15 `AgentKey`s (lib/agents.ts). Each operational executive here is BACKED
// by an AgentKey (the execution spine) and adds the governance primitives the
// skill runtime consumes — a bounded domain, the skills it may run, its data
// scope, an approval CEILING (it can never self-authorize above it), prohibited
// actions, and handoff rules. It also ACTIVATES the roles the roster lacked as
// first-class agents — Investment Committee, Risk & Compliance, Legal & Closing —
// each backed by an existing execution agent until a dedicated AgentKey lands.
//
// Reconciliation note: this supersedes the loose `VirtualExecutiveRole` list in
// lib/executive-team.ts as the operational model; it is keyed to `AgentKey` so
// it never drifts from the engine.

import type { AgentKey } from "@/lib/supabase/database.types";
import type { Hub } from "@/lib/supabase/database.types";
import type { ActionKind, GateTier } from "@/lib/gates";
import { tierForAction } from "@/lib/gates";

/** The operational executive team. A superset of the roster: it adds IC / Risk /
 *  Legal as first-class operational roles backed by an execution agent. */
export type ExecutiveKey =
  | "earn"
  | "analyst"
  | "deal_sourcer"
  | "diligence"
  | "investment_committee"
  | "investor_relations"
  | "capital_formation"
  | "portfolio_ops"
  | "fund_admin"
  | "risk_compliance"
  | "legal_closing"
  | "research"
  | "communications";

export interface ExecutiveDefinition {
  key: ExecutiveKey;
  label: string;
  /** The execution agent the engine assigns for this executive's work. */
  backingAgent: AgentKey;
  hub: Hub | null;
  /** One-line bounded remit. */
  domain: string;
  /** Skill IDs this executive is permitted to run. "*" = orchestration (Earn). */
  allowedSkills: string[];
  /** Entity types this executive may read (data-access scope). */
  dataScopes: string[];
  /**
   * The highest gate tier this executive may act at. Tier 3 is NEVER delegable —
   * a ceiling is clamped to 2, and any Tier-3 action always escalates to a human
   * regardless of ceiling (enforced by `canExecutiveActAt`).
   */
  approvalCeiling: GateTier;
  /** Actions this executive may never take, even to prepare. */
  prohibitedActions: ActionKind[];
  /** Capability-level prohibitions that are not ActionKinds (advisory guardrails). */
  prohibitedCapabilities: string[];
  /** Executives this one hands off to. */
  handoffTo: ExecutiveKey[];
  /** The review standard its work product must meet before release. */
  reviewStandard: string;
}

// Common data scopes.
const DEAL_SCOPE = ["deal", "company", "financial_model", "diligence_request", "diligence_finding"];
const CAPITAL_SCOPE = ["investor", "commitment", "allocation", "capital_activity", "fund"];
const PORTFOLIO_SCOPE = ["portfolio_company", "kpi", "covenant", "initiative"];

export const EXECUTIVES: ExecutiveDefinition[] = [
  {
    key: "earn",
    label: "Earn",
    backingAgent: "associate",
    hub: null,
    domain: "Orchestration — intent resolution, planning, delegation, synthesis, approvals, next-action routing.",
    allowedSkills: ["*"],
    dataScopes: ["*"],
    approvalCeiling: 1,
    prohibitedActions: ["move_capital", "capital_call", "sign_document", "submit_term_sheet"],
    prohibitedCapabilities: ["self_approve_tier_3"],
    handoffTo: [
      "analyst",
      "deal_sourcer",
      "diligence",
      "investment_committee",
      "investor_relations",
      "capital_formation",
      "portfolio_ops",
      "fund_admin",
      "risk_compliance",
      "legal_closing",
      "research",
      "communications",
    ],
    reviewStandard: "Every delegated step returns reviewable work product with provenance before synthesis.",
  },
  {
    key: "analyst",
    label: "Analyst",
    backingAgent: "analyst",
    hub: "run",
    domain: "Financial spreading, comps, DCF, LBO, three-statement, unit economics, returns, sensitivity, model audit.",
    allowedSkills: ["screen-deal", "returns", "lbo", "dcf", "three-statement", "comps", "unit-economics", "model-audit"],
    dataScopes: DEAL_SCOPE,
    approvalCeiling: 1,
    prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
    prohibitedCapabilities: ["invent_financial_values", "final_valuation_signoff"],
    handoffTo: ["diligence", "investment_committee"],
    reviewStandard: "Facts, assumptions, and calculations are separated; every material number carries a source.",
  },
  {
    key: "deal_sourcer",
    label: "Deal Sourcing Executive",
    backingAgent: "deal_sourcer",
    hub: "source",
    domain: "Target discovery, mandate matching, CRM/duplicate checks, enrichment, outreach drafts, sourcing lists.",
    allowedSkills: ["source-deals", "screen-deal", "buyer-list"],
    dataScopes: ["company", "deal", "contact", "pipeline"],
    approvalCeiling: 2,
    prohibitedActions: ["move_capital", "capital_call", "sign_document", "submit_term_sheet", "execute_subdoc"],
    prohibitedCapabilities: ["bind_organization"],
    handoffTo: ["analyst", "diligence"],
    reviewStandard: "Founder/target outreach is drafted for review; nothing external sends without sign-off.",
  },
  {
    key: "diligence",
    label: "Diligence Executive",
    backingAgent: "diligence",
    hub: "run",
    domain: "Diligence request lists, document indexing, red-flag extraction, evidence mapping, meeting prep.",
    allowedSkills: ["dd-checklist", "dd-prep", "screen-deal"],
    dataScopes: DEAL_SCOPE.concat(["document", "data_room"]),
    approvalCeiling: 2,
    prohibitedActions: ["move_capital", "capital_call", "sign_document", "execute_subdoc"],
    prohibitedCapabilities: ["final_legal_conclusion"],
    handoffTo: ["analyst", "investment_committee", "legal_closing"],
    reviewStandard: "Findings cite the source document; red flags separate evidence from inference.",
  },
  {
    key: "investment_committee",
    label: "Investment Committee Executive",
    backingAgent: "executive_advisor",
    hub: "run",
    domain: "Screening summaries, theses, risk synthesis, IC memoranda, open-issue logs, decision records, conditions precedent.",
    allowedSkills: ["screen-deal", "ic-memo", "returns"],
    dataScopes: DEAL_SCOPE.concat(["ic_memo", "decision", "valuation"]),
    approvalCeiling: 1,
    prohibitedActions: ["move_capital", "capital_call", "submit_term_sheet", "sign_document"],
    prohibitedCapabilities: ["approve_investment_decision", "self_approve_tier_3"],
    handoffTo: ["analyst", "diligence", "legal_closing"],
    reviewStandard: "The memo assembles from structured deal data + linked evidence; recommendations are not final decisions.",
  },
  {
    key: "investor_relations",
    label: "Investor Relations Executive",
    backingAgent: "investor_relations",
    hub: "execute",
    domain: "Investor segmentation, LP profiles, meeting prep, quarterly updates, capital-call and distribution notices, data-room access.",
    allowedSkills: ["lp-update", "capital-call", "distribution-notice", "investor-profile"],
    dataScopes: CAPITAL_SCOPE.concat(["communication", "meeting", "data_room"]),
    approvalCeiling: 2,
    prohibitedActions: ["move_capital", "capital_call", "sign_document", "post_journal_entry"],
    prohibitedCapabilities: ["release_capital_call_without_approval", "release_statement_without_approval"],
    handoffTo: ["fund_admin", "capital_formation"],
    reviewStandard: "LP communications are drafted for review; capital-call/distribution NOTICES prepare, never execute, capital movement.",
  },
  {
    key: "capital_formation",
    label: "Capital Formation Executive",
    backingAgent: "capital_raiser",
    hub: "source",
    domain: "Investor targeting, relationship mapping, raise pipeline, outreach sequences, allocation & commitment tracking, closing readiness.",
    allowedSkills: ["investor-profile", "raise-pipeline", "commitment-tracker"],
    dataScopes: CAPITAL_SCOPE.concat(["contact"]),
    approvalCeiling: 2,
    prohibitedActions: ["move_capital", "capital_call", "sign_document", "submit_term_sheet", "execute_subdoc"],
    prohibitedCapabilities: ["bind_commitment"],
    handoffTo: ["investor_relations", "legal_closing"],
    reviewStandard: "Outreach is drafted for review; commitment/allocation records track, never bind, capital.",
  },
  {
    key: "portfolio_ops",
    label: "Portfolio Operations Executive",
    backingAgent: "portfolio_ops",
    hub: "execute",
    domain: "KPI collection, budget-to-actual, covenant monitoring, 100-day plans, EBITDA bridges, value-creation, portfolio reporting.",
    allowedSkills: ["portfolio-review", "value-creation", "kpi-ingest"],
    dataScopes: PORTFOLIO_SCOPE,
    approvalCeiling: 1,
    prohibitedActions: ["move_capital", "sign_document", "distribute_report"],
    prohibitedCapabilities: [],
    handoffTo: ["fund_admin", "analyst"],
    reviewStandard: "KPI-derived figures cite their ingestion source; variance commentary separates data from narrative.",
  },
  {
    key: "fund_admin",
    label: "Fund Administration Executive",
    backingAgent: "fund_admin",
    hub: "execute",
    domain: "Entity calendar, close checklist, capital activity, NAV support, reconciliations, statement review, accruals, roll-forwards.",
    allowedSkills: ["reconcile", "nav-review", "close-period", "audit-statement"],
    dataScopes: CAPITAL_SCOPE.concat(["capital_activity"]),
    approvalCeiling: 1,
    prohibitedActions: [
      "post_journal_entry",
      "post_to_closed_period",
      "close_period",
      "reopen_period",
      "move_capital",
      "capital_call",
    ],
    prohibitedCapabilities: ["post_entries_without_approval", "approve_nav", "release_statement_without_approval"],
    handoffTo: ["investor_relations", "risk_compliance"],
    reviewStandard: "Reconciliations and NAV tie-outs prepare work for review; posting/close/NAV approval is always human.",
  },
  {
    key: "risk_compliance",
    label: "Risk & Compliance Executive",
    backingAgent: "diligence",
    hub: "run",
    domain: "KYC, AML support, onboarding exceptions, policy checks, restricted actions, conflicts, risk registers, compliance evidence, escalation.",
    allowedSkills: ["kyc-screen", "policy-check", "risk-register"],
    dataScopes: ["investor", "contact", "document", "deal"],
    approvalCeiling: 1,
    prohibitedActions: ["move_capital", "capital_call", "sign_document", "execute_subdoc"],
    prohibitedCapabilities: ["approve_onboarding", "final_compliance_determination", "override_compliance_personnel"],
    handoffTo: ["legal_closing", "investor_relations"],
    reviewStandard: "Screening evaluates a rules grid and routes exceptions; it never makes the final compliance determination.",
  },
  {
    key: "legal_closing",
    label: "Legal & Closing Executive",
    backingAgent: "diligence",
    hub: "execute",
    domain: "Document and closing coordination, checklists, approval packages, closing readiness.",
    allowedSkills: ["closing-checklist", "deal-tracker"],
    dataScopes: DEAL_SCOPE.concat(["document", "data_room"]),
    approvalCeiling: 1,
    prohibitedActions: ["sign_document", "execute_subdoc", "submit_term_sheet", "move_capital"],
    prohibitedCapabilities: ["provide_unreviewed_legal_advice", "bind_organization"],
    handoffTo: ["investment_committee", "fund_admin"],
    reviewStandard: "Coordinates documents and closings; never gives unreviewed legal advice or binds the organization.",
  },
  {
    key: "research",
    label: "Research & Market Intelligence Executive",
    backingAgent: "executive_advisor",
    hub: "source",
    domain: "Sector research, market maps, competitive landscapes, thematic analysis, catalyst tracking, source-quality review.",
    allowedSkills: ["market-map", "sector-research"],
    dataScopes: ["company", "deal", "sector", "geography"],
    approvalCeiling: 1,
    prohibitedActions: ["send_outreach", "distribute_report", "sign_document"],
    prohibitedCapabilities: [],
    handoffTo: ["analyst", "deal_sourcer", "investment_committee"],
    reviewStandard: "Every material claim carries a source; source quality is graded.",
  },
  {
    key: "communications",
    label: "Communications Executive",
    backingAgent: "pr_director",
    hub: "build",
    domain: "Commercial communications — investor materials, brand narrative, content, lead capture. Consolidates PR, SEO, Curator, Lead Gen.",
    allowedSkills: ["teaser", "cim"],
    dataScopes: ["company", "deal", "communication"],
    approvalCeiling: 2,
    prohibitedActions: ["move_capital", "capital_call", "sign_document"],
    prohibitedCapabilities: ["publish_externally_without_approval"],
    handoffTo: ["investor_relations", "capital_formation"],
    reviewStandard: "External materials are drafted for review; nothing publishes without authorization.",
  },
];

export const EXECUTIVE_BY_KEY: Record<ExecutiveKey, ExecutiveDefinition> = Object.fromEntries(
  EXECUTIVES.map((e) => [e.key, e]),
) as Record<ExecutiveKey, ExecutiveDefinition>;

export function getExecutive(key: ExecutiveKey): ExecutiveDefinition | null {
  return EXECUTIVE_BY_KEY[key] ?? null;
}

/** True when the executive is permitted to run the given skill. */
export function canRunSkill(key: ExecutiveKey, skillId: string): boolean {
  const exec = EXECUTIVE_BY_KEY[key];
  if (!exec) return false;
  return exec.allowedSkills.includes("*") || exec.allowedSkills.includes(skillId);
}

/**
 * Whether an executive may act autonomously at a gate tier. Tier 3 is NEVER
 * delegable — always false regardless of ceiling. Below/at the ceiling is
 * permitted; above requires escalation.
 */
export function canExecutiveActAt(key: ExecutiveKey, tier: GateTier): boolean {
  if (tier === 3) return false;
  const exec = EXECUTIVE_BY_KEY[key];
  if (!exec) return false;
  return tier <= exec.approvalCeiling;
}

/** True when the action is on the executive's prohibited list (by action or tier-3). */
export function isActionProhibited(key: ExecutiveKey, action: ActionKind): boolean {
  const exec = EXECUTIVE_BY_KEY[key];
  if (!exec) return true;
  if (exec.prohibitedActions.includes(action)) return true;
  // Tier 3 is structurally prohibited for autonomous execution by any executive.
  return tierForAction(action) === 3;
}

/** The executives permitted to run a given skill (for routing + UI). */
export function executivesForSkill(skillId: string): ExecutiveDefinition[] {
  return EXECUTIVES.filter((e) => e.allowedSkills.includes("*") === false && e.allowedSkills.includes(skillId));
}
