// lib/skills/catalog/portfolio-review.ts
// Native skill: a PORTFOLIO COMPANY REVIEW — budget-to-actual variance on
// revenue and EBITDA plus a covenant compliance check. Pure, deterministic core
// — the tested execution path. Like every FundExecs skill it NEVER invents a
// financial value: a missing input is FLAGGED (missingFields), a provided figure
// is a fact (kind:"fact"), and every computed number (variance, variance %,
// covenant status) is a calculation (kind:"calculation"). LLM enrichment of the
// narrative is an optional follow-on that wraps this core; the variances, the
// covenant verdicts, and the breaches come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type CovenantType = "min" | "max";

export interface CovenantInput {
  name: string;
  threshold?: number;
  actual?: number;
  type?: CovenantType;
}

export interface PortfolioReviewInput {
  companyName: string;
  period?: string;
  budgetRevenue?: number;
  actualRevenue?: number;
  budgetEbitda?: number;
  actualEbitda?: number;
  covenants?: CovenantInput[];
}

export type CovenantStatus = "pass" | "breach" | "unknown";

export interface CovenantCheck {
  name: string;
  threshold: number | null;
  actual: number | null;
  type: CovenantType | null;
  status: CovenantStatus;
}

export interface PortfolioReviewOutput {
  revenueVariance: number | null;
  revenueVariancePct: number | null;
  ebitdaVariance: number | null;
  ebitdaVariancePct: number | null;
  covenantChecks: CovenantCheck[];
  breaches: string[];
  missingFields: string[];
  keyRisks: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Absolute variance (2 dp) — null unless both budget and actual are present. */
function variance(actual: number | undefined, budget: number | undefined): number | null {
  return actual != null && budget != null ? round2(actual - budget) : null;
}

/** Variance as a % of budget (1 dp) — null unless the variance exists and budget is non-zero. */
function variancePct(v: number | null, budget: number | undefined): number | null {
  return v != null && budget ? round1((v / budget) * 100) : null;
}

/** Covenant status: min ⇒ actual must be ≥ threshold; max ⇒ actual must be ≤ threshold. */
function covenantStatus(c: CovenantInput): CovenantStatus {
  if (c.threshold == null || c.actual == null || !c.type) return "unknown";
  if (c.type === "min") return c.actual >= c.threshold ? "pass" : "breach";
  return c.actual <= c.threshold ? "pass" : "breach";
}

const run: SkillCore<PortfolioReviewInput, PortfolioReviewOutput> = (input): SkillCoreResult<PortfolioReviewOutput> => {
  const sources: SkillSource[] = [];
  const missingFields: string[] = [];
  const keyRisks: string[] = [];

  // --- Provided figures are FACTS. Nothing here is fabricated. ---
  if (input.period != null) sources.push({ label: "Reporting period", kind: "fact", value: input.period });
  if (input.budgetRevenue != null) sources.push({ label: "Budget revenue", kind: "fact", value: input.budgetRevenue });
  if (input.actualRevenue != null) sources.push({ label: "Actual revenue", kind: "fact", value: input.actualRevenue });
  if (input.budgetEbitda != null) sources.push({ label: "Budget EBITDA", kind: "fact", value: input.budgetEbitda });
  if (input.actualEbitda != null) sources.push({ label: "Actual EBITDA", kind: "fact", value: input.actualEbitda });

  // --- Missing material inputs are FLAGGED, never invented. ---
  if (input.period == null) missingFields.push("Period");
  if (input.budgetRevenue == null) missingFields.push("Budget revenue");
  if (input.actualRevenue == null) missingFields.push("Actual revenue");
  if (input.budgetEbitda == null) missingFields.push("Budget EBITDA");
  if (input.actualEbitda == null) missingFields.push("Actual EBITDA");

  // --- Budget-to-actual variances — CALCULATIONS only when both figures exist. ---
  const revenueVariance = variance(input.actualRevenue, input.budgetRevenue);
  const revenueVariancePct = variancePct(revenueVariance, input.budgetRevenue);
  const ebitdaVariance = variance(input.actualEbitda, input.budgetEbitda);
  const ebitdaVariancePct = variancePct(ebitdaVariance, input.budgetEbitda);

  if (revenueVariance != null) {
    sources.push({ label: "Revenue variance", kind: "calculation", value: revenueVariance, ref: "actualRevenue − budgetRevenue" });
  }
  if (revenueVariancePct != null) {
    sources.push({ label: "Revenue variance %", kind: "calculation", value: `${revenueVariancePct}%`, ref: "revenueVariance / budgetRevenue × 100" });
  }
  if (ebitdaVariance != null) {
    sources.push({ label: "EBITDA variance", kind: "calculation", value: ebitdaVariance, ref: "actualEbitda − budgetEbitda" });
  }
  if (ebitdaVariancePct != null) {
    sources.push({ label: "EBITDA variance %", kind: "calculation", value: `${ebitdaVariancePct}%`, ref: "ebitdaVariance / budgetEbitda × 100" });
  }

  // --- Covenant checks — status is a CALCULATION; a covenant lacking data is 'unknown'. ---
  const covenants = input.covenants ?? [];
  const covenantChecks: CovenantCheck[] = covenants.map((c) => {
    const status = covenantStatus(c);
    const check: CovenantCheck = {
      name: c.name,
      threshold: c.threshold ?? null,
      actual: c.actual ?? null,
      type: c.type ?? null,
      status,
    };
    if (status !== "unknown") {
      sources.push({ label: `Covenant "${c.name}" status`, kind: "calculation", value: status, ref: `actual ${c.type === "min" ? "≥" : "≤"} threshold` });
    } else {
      missingFields.push(`Covenant "${c.name}" — threshold, actual, or type missing`);
    }
    return check;
  });

  const breaches = covenantChecks.filter((c) => c.status === "breach").map((c) => c.name);

  // --- Key risks (deterministic). ---
  if (revenueVariancePct != null && revenueVariancePct <= -10) {
    keyRisks.push(`Revenue ${revenueVariancePct}% below budget (>10% shortfall).`);
  }
  if (ebitdaVariancePct != null && ebitdaVariancePct <= -10) {
    keyRisks.push(`EBITDA ${ebitdaVariancePct}% below budget (>10% shortfall).`);
  }
  for (const name of breaches) {
    keyRisks.push(`Covenant breach: ${name}.`);
  }

  // --- Completeness / confidence / recommendation. ---
  const MATERIAL = ["period", "budgetRevenue", "actualRevenue", "budgetEbitda", "actualEbitda"] as const;
  const present = MATERIAL.filter((k) => input[k] != null).length + (covenants.length > 0 ? 1 : 0);
  const completeness = Math.round((present / (MATERIAL.length + 1)) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5));

  const recommendedAction =
    breaches.length > 0
      ? `Escalate covenant breach(es) (${breaches.join(", ")}) to the deal team and lender; prepare a waiver or remediation plan.`
      : keyRisks.length > 0
        ? "Investigate the budget shortfall with management and revise the forecast before the next review."
        : revenueVariance == null && ebitdaVariance == null && covenantChecks.length === 0
          ? "Provide budget and actual revenue/EBITDA (and covenant thresholds) to complete the review."
          : "On track — continue standard periodic monitoring.";

  const structured: PortfolioReviewOutput = {
    revenueVariance,
    revenueVariancePct,
    ebitdaVariance,
    ebitdaVariancePct,
    covenantChecks,
    breaches,
    missingFields,
    keyRisks,
    recommendedAction,
  };

  const periodLabel = input.period ? ` (${input.period})` : "";
  const varParts: string[] = [];
  if (revenueVariancePct != null) varParts.push(`revenue ${revenueVariancePct >= 0 ? "+" : ""}${revenueVariancePct}% vs budget`);
  if (ebitdaVariancePct != null) varParts.push(`EBITDA ${ebitdaVariancePct >= 0 ? "+" : ""}${ebitdaVariancePct}% vs budget`);
  const narrative =
    `Portfolio review of ${input.companyName}${periodLabel}: ` +
    `${varParts.length ? `${varParts.join(", ")}. ` : "budget-to-actual not computable on current data. "}` +
    `${breaches.length ? `Covenant breach(es): ${breaches.join(", ")}. ` : covenantChecks.length ? "No covenant breaches. " : ""}` +
    `${missingFields.length ? `Missing: ${missingFields.join(", ")}. ` : ""}` +
    `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["companyName"],
  properties: {
    companyName: { type: "string", minLength: 1 },
    period: { type: "string" },
    budgetRevenue: { type: "number" },
    actualRevenue: { type: "number" },
    budgetEbitda: { type: "number" },
    actualEbitda: { type: "number" },
    covenants: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          threshold: { type: "number" },
          actual: { type: "number" },
          type: { type: "string", enum: ["min", "max"] },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["covenantChecks", "breaches", "recommendedAction"],
  properties: {
    revenueVariance: { type: "number" },
    revenueVariancePct: { type: "number" },
    ebitdaVariance: { type: "number" },
    ebitdaVariancePct: { type: "number" },
    covenantChecks: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "status"],
        properties: {
          name: { type: "string" },
          threshold: { type: "number" },
          actual: { type: "number" },
          type: { type: "string", enum: ["min", "max"] },
          status: { type: "string", enum: ["pass", "breach", "unknown"] },
        },
      },
    },
    breaches: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const portfolioReviewManifest: SkillManifest = {
  id: "portfolio-review",
  name: "Portfolio Company Review",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops"],
  supportedEntityTypes: ["portfolio_company", "company", "financial_report"],
  requiredInputs: ["companyName"],
  optionalInputs: ["period", "budgetRevenue", "actualRevenue", "budgetEbitda", "actualEbitda", "covenants"],
  outputs: ["revenueVariance", "revenueVariancePct", "ebitdaVariance", "ebitdaVariancePct", "covenantChecks", "breaches", "missingFields", "keyRisks", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["portfolio_company:read", "financial_report:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated financial values", "covenant status derived, not assumed"],
  evaluationCriteria: ["correct variance math on golden cases", "missing data flagged not invented", "covenant breaches detected on min and max covenants", "material budget shortfalls surfaced as risks"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["value-creation"],
  prohibitedActions: ["distribute_report", "move_capital", "sign_document"],
  inputSchema,
  outputSchema,
};

export const portfolioReview: SkillDefinition<PortfolioReviewInput, PortfolioReviewOutput> = {
  manifest: portfolioReviewManifest,
  run,
};
