// lib/skills/catalog/unit-economics.ts
// Native skill: a first-pass UNIT ECONOMICS read for a company — annual gross
// profit per user, LTV, LTV/CAC, and CAC payback — with a health band, the key
// risks, and the material data that is missing. Pure, deterministic core: the
// tested execution path. Like every FundExecs skill it NEVER invents financial
// values: a missing input is FLAGGED (missingFields), a provided figure is a
// fact (kind:"fact"), and every computed number is a calculation
// (kind:"calculation"). LLM enrichment of the narrative is an optional follow-on
// that wraps this core; the LTV, the ratio, and the payback come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface UnitEconomicsInput {
  companyName: string;
  /** Annual average revenue per user, $. */
  arpu?: number;
  /** Customer acquisition cost, $. */
  cac?: number;
  /** Gross margin, percent (0–100). */
  grossMarginPct?: number;
  /** Annual customer churn, percent (0–100). */
  churnRatePct?: number;
}

export type UnitEconomicsBand = "healthy" | "watch" | "unhealthy";

export interface UnitEconomicsOutput {
  annualGrossProfitPerUser: number | null;
  ltv: number | null;
  ltvCacRatio: number | null;
  paybackMonths: number | null;
  band: UnitEconomicsBand | null;
  missingFields: string[];
  keyRisks: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

const REQUIRED_FIELDS: Array<[keyof UnitEconomicsInput, string]> = [
  ["arpu", "ARPU"],
  ["cac", "CAC"],
  ["grossMarginPct", "Gross margin %"],
  ["churnRatePct", "Churn rate %"],
];

const run: SkillCore<UnitEconomicsInput, UnitEconomicsOutput> = (input): SkillCoreResult<UnitEconomicsOutput> => {
  const { companyName, arpu, cac, grossMarginPct, churnRatePct } = input;
  const sources: SkillSource[] = [];
  const keyRisks: string[] = [];

  // --- Provided figures are FACTS. Nothing here is fabricated. ---
  if (arpu != null) sources.push({ label: "ARPU", kind: "fact", value: arpu });
  if (cac != null) sources.push({ label: "CAC", kind: "fact", value: cac });
  if (grossMarginPct != null) sources.push({ label: "Gross margin %", kind: "fact", value: `${grossMarginPct}%` });
  if (churnRatePct != null) sources.push({ label: "Churn rate %", kind: "fact", value: `${churnRatePct}%` });

  // --- Missing material inputs are FLAGGED, never invented. ---
  const missingFields = REQUIRED_FIELDS.filter(([k]) => input[k] == null).map(([, label]) => label);

  // --- Annual gross profit per user (CALCULATION, only when inputs exist). ---
  let annualGrossProfitPerUser: number | null = null;
  if (arpu != null && grossMarginPct != null) {
    annualGrossProfitPerUser = round2(arpu * (grossMarginPct / 100));
    sources.push({ label: "Annual gross profit per user", kind: "calculation", value: annualGrossProfitPerUser, ref: "arpu × (grossMarginPct ÷ 100)" });
  }

  // --- LTV — guard divide-by-zero on churn. ---
  let ltv: number | null = null;
  if (annualGrossProfitPerUser != null && churnRatePct != null) {
    if (churnRatePct > 0) {
      ltv = round2(annualGrossProfitPerUser / (churnRatePct / 100));
      sources.push({ label: "LTV", kind: "calculation", value: ltv, ref: "annualGrossProfitPerUser ÷ (churnRatePct ÷ 100)" });
    } else {
      keyRisks.push("Churn rate 0 — LTV undefined");
    }
  }

  // --- LTV / CAC ratio (CALCULATION). ---
  let ltvCacRatio: number | null = null;
  if (ltv != null && cac != null && cac > 0) {
    ltvCacRatio = round2(ltv / cac);
    sources.push({ label: "LTV / CAC ratio", kind: "calculation", value: `${ltvCacRatio}x`, ref: "ltv ÷ cac" });
  }

  // --- CAC payback in months (CALCULATION). ---
  let paybackMonths: number | null = null;
  if (annualGrossProfitPerUser != null && annualGrossProfitPerUser > 0 && cac != null) {
    paybackMonths = round1(cac / (annualGrossProfitPerUser / 12));
    sources.push({ label: "CAC payback (months)", kind: "calculation", value: paybackMonths, ref: "cac ÷ (annualGrossProfitPerUser ÷ 12)" });
  }

  // --- Health band. ---
  const band: UnitEconomicsBand | null =
    ltvCacRatio == null ? null : ltvCacRatio >= 3 ? "healthy" : ltvCacRatio >= 1 ? "watch" : "unhealthy";

  // --- Key risks (deterministic). ---
  if (paybackMonths != null && paybackMonths > 24) keyRisks.push("Long payback (>24mo)");
  if (band === "unhealthy") keyRisks.push("LTV/CAC below 1 — acquisition uneconomic");

  // --- Completeness / confidence / recommendation. ---
  const present = REQUIRED_FIELDS.length - missingFields.length;
  const completeness = Math.round((present / REQUIRED_FIELDS.length) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5));

  const recommendedAction = missingFields.length
    ? `Provide ${missingFields.join(", ")} to compute unit economics.`
    : band === "healthy"
      ? "Unit economics are healthy (LTV/CAC ≥ 3) — scale acquisition spend and advance to an IC memo."
      : band === "watch"
        ? "Unit economics are workable but thin (LTV/CAC 1–3) — improve retention or margin before scaling spend."
        : band === "unhealthy"
          ? "Acquisition is uneconomic on current data (LTV/CAC < 1) — fix retention, pricing, or CAC before investing further."
          : "LTV is undefined (zero churn) — supply a positive churn rate to complete the unit-economics read.";

  const structured: UnitEconomicsOutput = {
    annualGrossProfitPerUser,
    ltv,
    ltvCacRatio,
    paybackMonths,
    band,
    missingFields,
    keyRisks,
    recommendedAction,
  };

  const narrative = missingFields.length
    ? `Unit economics for ${companyName} not computable — missing ${missingFields.join(", ")}. Next: ${recommendedAction}`
    : `Unit economics for ${companyName}: ${ltvCacRatio != null ? `${ltvCacRatio}x LTV/CAC` : "LTV/CAC n/a"}` +
      `${band != null ? ` (${band})` : ""}` +
      `${paybackMonths != null ? `, ${paybackMonths}mo CAC payback` : ""}. ` +
      `${keyRisks.length ? `Risks: ${keyRisks.join("; ")}. ` : ""}Next: ${recommendedAction}`;

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
    arpu: { type: "number", minimum: 0 },
    cac: { type: "number", minimum: 0 },
    grossMarginPct: { type: "number", minimum: 0, maximum: 100 },
    churnRatePct: { type: "number", minimum: 0, maximum: 100 },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["ltvCacRatio", "band", "missingFields", "keyRisks", "recommendedAction"],
  properties: {
    annualGrossProfitPerUser: { type: "number" },
    ltv: { type: "number" },
    ltvCacRatio: { type: "number" },
    paybackMonths: { type: "number" },
    band: { type: "string", enum: ["healthy", "watch", "unhealthy"] },
    missingFields: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const unitEconomicsManifest: SkillManifest = {
  id: "unit-economics",
  name: "Unit Economics",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst"],
  supportedEntityTypes: ["company", "deal", "financial_model"],
  requiredInputs: ["companyName"],
  optionalInputs: ["arpu", "cac", "grossMarginPct", "churnRatePct"],
  outputs: ["annualGrossProfitPerUser", "ltv", "ltvCacRatio", "paybackMonths", "band", "missingFields", "keyRisks", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["company:read", "financial_model:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated financial values", "LTV null when churn is zero (no divide-by-zero)"],
  evaluationCriteria: ["correct LTV / LTV-CAC / payback math on golden cases", "missing data flagged not invented", "divide-by-zero guarded (churn 0 → LTV null)", "band thresholds correct (≥3 healthy, ≥1 watch, else unhealthy)"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document"],
  inputSchema,
  outputSchema,
};

export const unitEconomics: SkillDefinition<UnitEconomicsInput, UnitEconomicsOutput> = {
  manifest: unitEconomicsManifest,
  run,
};
