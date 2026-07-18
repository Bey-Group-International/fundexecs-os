// lib/skills/catalog/nav-review.ts
// Native skill: prepare a NAV roll-forward TIE-OUT for review. Pure,
// deterministic core — the tested execution path. Like every FundExecs skill it
// NEVER invents financial values: a missing prior/reported NAV is FLAGGED
// (missingFields), an absent flow component defaults to 0 but is LABELLED as an
// assumption (kind:"assumption"), a provided figure is a fact (kind:"fact"), and
// every computed number is a calculation (kind:"calculation"). This skill only
// PREPARES the tie-out — NAV approval and LP reporting are a human decision and
// are never performed here. LLM enrichment of the narrative is an optional
// follow-on that wraps this core; the roll-forward and the tie-out come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface NavReviewInput {
  fundName: string;
  /** Prior-period net asset value. Required to compute a roll-forward. */
  priorNav?: number;
  /** Capital contributions in the period (increases NAV). */
  contributions?: number;
  /** Distributions in the period (decreases NAV). */
  distributions?: number;
  /** Realized gain/loss in the period (signed; increases NAV). */
  realizedGainLoss?: number;
  /** Unrealized gain/loss in the period (signed; increases NAV). */
  unrealizedGainLoss?: number;
  /** Management/other fees in the period (decreases NAV). */
  fees?: number;
  /** Fund expenses in the period (decreases NAV). */
  expenses?: number;
  /** Administrator's reported NAV — the figure the roll-forward is tied out to. */
  reportedNav?: number;
}

export interface RollForwardLine {
  component: string;
  amount: number;
}

export interface NavReviewOutput {
  computedNav: number | null;
  tieOutDifference: number | null;
  tiesOut: boolean;
  rollForward: RollForwardLine[];
  missingFields: string[];
  keyRisks: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The signed flow components of the roll-forward, in presentation order. */
const FLOW_COMPONENTS: Array<{ key: keyof NavReviewInput; label: string; sign: 1 | -1 }> = [
  { key: "contributions", label: "Contributions", sign: 1 },
  { key: "distributions", label: "Distributions", sign: -1 },
  { key: "realizedGainLoss", label: "Realized gain/loss", sign: 1 },
  { key: "unrealizedGainLoss", label: "Unrealized gain/loss", sign: 1 },
  { key: "fees", label: "Fees", sign: -1 },
  { key: "expenses", label: "Expenses", sign: -1 },
];

const run: SkillCore<NavReviewInput, NavReviewOutput> = (input): SkillCoreResult<NavReviewOutput> => {
  const sources: SkillSource[] = [];
  const missingFields: string[] = [];
  const keyRisks: string[] = [];
  const assumptionsUsed: string[] = [];

  // --- Prior NAV is the anchor. Provided → FACT; absent → FLAGGED, never assumed. ---
  const hasPrior = input.priorNav != null;
  if (hasPrior) {
    sources.push({ label: "Prior NAV", kind: "fact", value: input.priorNav as number });
  } else {
    missingFields.push("Prior NAV");
    keyRisks.push("Prior NAV missing — the roll-forward cannot be computed.");
  }

  // --- Flow components. Provided → FACT; absent → 0 but LABELLED as an assumption. ---
  const rollForward: RollForwardLine[] = [];
  if (hasPrior) rollForward.push({ component: "Prior NAV", amount: round2(input.priorNav as number) });

  let flowsTotal = 0;
  for (const { key, label, sign } of FLOW_COMPONENTS) {
    const provided = input[key] as number | undefined;
    const value = provided ?? 0;
    if (provided != null) {
      sources.push({ label, kind: "fact", value: provided });
    } else {
      // Missing component treated as 0 — but recorded as an ASSUMPTION, never a fact.
      assumptionsUsed.push(`Assumed ${label} = 0`);
      sources.push({ label: `Assumed ${label} = 0`, kind: "assumption", value: 0 });
    }
    const signed = sign * value;
    flowsTotal += signed;
    rollForward.push({ component: label, amount: round2(signed) });
  }

  // --- Computed NAV — a CALCULATION, only when the prior NAV anchor exists. ---
  let computedNav: number | null = null;
  if (hasPrior) {
    computedNav = round2((input.priorNav as number) + flowsTotal);
    sources.push({
      label: "Computed NAV",
      kind: "calculation",
      value: computedNav,
      ref: "priorNav + contributions − distributions + realizedGainLoss + unrealizedGainLoss − fees − expenses",
    });
  }

  // --- Reported NAV + tie-out. ---
  let tieOutDifference: number | null = null;
  if (input.reportedNav != null) {
    sources.push({ label: "Reported NAV", kind: "fact", value: input.reportedNav });
    if (computedNav != null) {
      tieOutDifference = round2(input.reportedNav - computedNav);
      sources.push({ label: "Tie-out difference", kind: "calculation", value: tieOutDifference, ref: "reportedNav − computedNav" });
    }
  } else {
    // A missing reported NAV is an open item — flagged, never invented.
    missingFields.push("Reported NAV");
  }

  const tiesOut = tieOutDifference != null ? Math.abs(tieOutDifference) < 0.01 : false;

  // --- Key risks (deterministic). ---
  if (input.reportedNav != null && !tiesOut) keyRisks.push("Reported NAV does not tie to the roll-forward");
  if (input.reportedNav == null) keyRisks.push("Reported NAV not provided — tie-out is open and cannot be completed.");
  if (assumptionsUsed.length > 0) keyRisks.push("Roll-forward rests on default assumptions (components assumed 0) — confirm the missing components before relying on the tie-out.");

  // --- Completeness / confidence. ---
  const MATERIAL = ["priorNav", "contributions", "distributions", "realizedGainLoss", "unrealizedGainLoss", "fees", "expenses", "reportedNav"] as const;
  const present = MATERIAL.filter((k) => input[k] != null).length;
  const completeness = Math.round((present / MATERIAL.length) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5 - assumptionsUsed.length * 0.05));

  // --- Recommended action. Always: this only PREPARES a tie-out for review;
  //     NAV approval and reporting are a human decision, never performed here. ---
  const recommendedAction = !hasPrior
    ? "Provide the prior-period NAV so the roll-forward can be computed. This skill prepares a tie-out for human review — NAV approval and LP reporting are not performed here."
    : input.reportedNav == null
      ? `Roll-forward prepared (computed NAV ${computedNav}). Provide the administrator's reported NAV to complete the tie-out. This is prepared for human review — NAV approval and reporting remain a human decision.`
      : tiesOut
        ? `Tie-out prepared and reconciles: reported NAV matches the roll-forward (difference ${tieOutDifference}). Route to a human reviewer — NAV approval and LP reporting are not performed by this skill.`
        : `Tie-out prepared: reported NAV differs from the roll-forward by ${tieOutDifference}. Investigate the variance, then route to a human reviewer — NAV approval and reporting remain a human decision.`;

  const structured: NavReviewOutput = {
    computedNav,
    tieOutDifference,
    tiesOut,
    rollForward,
    missingFields,
    keyRisks,
    recommendedAction,
  };

  const narrative = !hasPrior
    ? `NAV tie-out for ${input.fundName} not computable — prior NAV missing. Next: ${recommendedAction}`
    : input.reportedNav == null
      ? `NAV roll-forward for ${input.fundName}: computed NAV ${computedNav} (reported NAV not yet provided). ` +
        `${assumptionsUsed.length ? `${assumptionsUsed.length} component(s) assumed 0. ` : ""}Next: ${recommendedAction}`
      : `NAV tie-out for ${input.fundName}: computed ${computedNav} vs reported ${input.reportedNav} — ` +
        `${tiesOut ? "TIES OUT" : `does NOT tie (difference ${tieOutDifference})`}. ` +
        `${assumptionsUsed.length ? `${assumptionsUsed.length} component(s) assumed 0. ` : ""}Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["fundName"],
  properties: {
    fundName: { type: "string", minLength: 1 },
    priorNav: { type: "number" },
    contributions: { type: "number" },
    distributions: { type: "number" },
    realizedGainLoss: { type: "number" },
    unrealizedGainLoss: { type: "number" },
    fees: { type: "number" },
    expenses: { type: "number" },
    reportedNav: { type: "number" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["computedNav", "tieOutDifference", "tiesOut", "rollForward", "recommendedAction"],
  properties: {
    computedNav: { type: "number" },
    tieOutDifference: { type: "number" },
    tiesOut: { type: "boolean" },
    rollForward: {
      type: "array",
      items: {
        type: "object",
        required: ["component", "amount"],
        properties: {
          component: { type: "string" },
          amount: { type: "number" },
        },
      },
    },
    missingFields: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const navReviewManifest: SkillManifest = {
  id: "nav-review",
  name: "NAV Tie-Out Review",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["fund_admin"],
  supportedEntityTypes: ["fund", "nav", "period"],
  requiredInputs: ["fundName"],
  optionalInputs: ["priorNav", "contributions", "distributions", "realizedGainLoss", "unrealizedGainLoss", "fees", "expenses", "reportedNav"],
  outputs: ["computedNav", "tieOutDifference", "tiesOut", "rollForward", "missingFields", "keyRisks", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["fund:read", "nav:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated financial values", "assumptions labelled, not presented as facts"],
  evaluationCriteria: ["correct roll-forward math on golden cases", "tie-out difference correct", "missing prior/reported NAV flagged not invented", "defaulted components labelled as assumptions", "NAV approval left to a human"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["lp-update"],
  prohibitedActions: ["post_journal_entry", "distribute_report", "move_capital", "close_period"],
  inputSchema,
  outputSchema,
};

export const navReview: SkillDefinition<NavReviewInput, NavReviewOutput> = {
  manifest: navReviewManifest,
  run,
};
