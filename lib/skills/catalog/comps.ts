// lib/skills/catalog/comps.ts
// Native skill: a COMPARABLE COMPANY ANALYSIS (trading comps) for a subject. Pure,
// deterministic core — the tested execution path. Like every FundExecs skill it
// NEVER invents financial values: a provided figure is a fact (kind:"fact"), every
// statistic and implied value is a calculation (kind:"calculation"), and a missing
// input is FLAGGED (missingData / missingFields), never fabricated. LLM enrichment
// of the narrative is an optional follow-on that wraps this core; the multiples,
// the implied valuation, and the range all come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface CompsSubject {
  companyName: string;
  /** Subject EBITDA, $M. */
  ebitda?: number;
  /** Subject revenue, $M. */
  revenue?: number;
  /** Subject net income, $M. */
  netIncome?: number;
}

export interface Comparable {
  name: string;
  /** EV / EBITDA multiple (x). */
  evEbitda?: number;
  /** EV / Revenue multiple (x). */
  evRevenue?: number;
  /** Price / earnings ratio (x). */
  peRatio?: number;
}

export interface CompsInput {
  subject: CompsSubject;
  comparables: Comparable[];
}

export interface MultipleStats {
  count: number;
  median: number;
  mean: number;
  min: number;
  max: number;
}

export interface CompsMultiples {
  evEbitda: MultipleStats | null;
  evRevenue: MultipleStats | null;
  peRatio: MultipleStats | null;
}

export interface ImpliedValuation {
  impliedEvFromEbitda: number | null;
  impliedEvFromRevenue: number | null;
  impliedEquityFromPe: number | null;
  evRangeLow: number | null;
  evRangeHigh: number | null;
}

export interface CompsOutput {
  multiples: CompsMultiples;
  impliedValuation: ImpliedValuation;
  missingFields: string[];
  keyRisks: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;

/** {count, median, mean, min, max} from the provided values (1dp). Null if none. */
function statsOf(values: number[]): MultipleStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  return {
    count: n,
    median: round1(median),
    mean: round1(mean),
    min: round1(sorted[0]),
    max: round1(sorted[n - 1]),
  };
}

/** Collect the provided values of one multiple across comparables (missing ignored). */
function collect(comps: Comparable[], key: keyof Omit<Comparable, "name">): number[] {
  return comps.map((c) => c[key]).filter((v): v is number => v != null);
}

const run: SkillCore<CompsInput, CompsOutput> = (input): SkillCoreResult<CompsOutput> => {
  const subject = input.subject;
  const comparables = input.comparables ?? [];
  const sources: SkillSource[] = [];
  const missingFields: string[] = [];
  const keyRisks: string[] = [];

  // --- Provided subject figures are FACTS. Nothing here is fabricated. ---
  if (subject.ebitda != null) sources.push({ label: "Subject EBITDA", kind: "fact", value: subject.ebitda });
  if (subject.revenue != null) sources.push({ label: "Subject revenue", kind: "fact", value: subject.revenue });
  if (subject.netIncome != null) sources.push({ label: "Subject net income", kind: "fact", value: subject.netIncome });

  // --- Provided comparable multiples are FACTS. ---
  for (const c of comparables) {
    if (c.evEbitda != null) sources.push({ label: `${c.name} EV/EBITDA`, kind: "fact", value: `${c.evEbitda}x` });
    if (c.evRevenue != null) sources.push({ label: `${c.name} EV/Revenue`, kind: "fact", value: `${c.evRevenue}x` });
    if (c.peRatio != null) sources.push({ label: `${c.name} P/E`, kind: "fact", value: `${c.peRatio}x` });
  }

  // --- Multiple statistics (CALCULATIONS), computed only from provided values. ---
  const evEbitda = statsOf(collect(comparables, "evEbitda"));
  const evRevenue = statsOf(collect(comparables, "evRevenue"));
  const peRatio = statsOf(collect(comparables, "peRatio"));

  if (evEbitda != null) sources.push({ label: "Median EV/EBITDA", kind: "calculation", value: `${evEbitda.median}x`, ref: "median of comparable EV/EBITDA" });
  else missingFields.push("EV/EBITDA comparables");
  if (evRevenue != null) sources.push({ label: "Median EV/Revenue", kind: "calculation", value: `${evRevenue.median}x`, ref: "median of comparable EV/Revenue" });
  else missingFields.push("EV/Revenue comparables");
  if (peRatio != null) sources.push({ label: "Median P/E", kind: "calculation", value: `${peRatio.median}x`, ref: "median of comparable P/E" });
  else missingFields.push("P/E comparables");

  // --- Subject metrics required to apply the multiples; missing ones are FLAGGED. ---
  if (subject.ebitda == null) missingFields.push("Subject EBITDA");
  if (subject.revenue == null) missingFields.push("Subject revenue");
  if (subject.netIncome == null) missingFields.push("Subject net income");

  // --- Implied valuation (CALCULATIONS). Null when the subject metric is missing
  //     OR the corresponding multiple has zero comparables. ---
  let impliedEvFromEbitda: number | null = null;
  if (subject.ebitda != null && evEbitda != null) {
    impliedEvFromEbitda = round1(evEbitda.median * subject.ebitda);
    sources.push({ label: "Implied EV from EBITDA", kind: "calculation", value: impliedEvFromEbitda, ref: "median EV/EBITDA × subject EBITDA" });
  }

  let impliedEvFromRevenue: number | null = null;
  if (subject.revenue != null && evRevenue != null) {
    impliedEvFromRevenue = round1(evRevenue.median * subject.revenue);
    sources.push({ label: "Implied EV from revenue", kind: "calculation", value: impliedEvFromRevenue, ref: "median EV/Revenue × subject revenue" });
  }

  let impliedEquityFromPe: number | null = null;
  if (subject.netIncome != null && peRatio != null) {
    impliedEquityFromPe = round1(peRatio.median * subject.netIncome);
    sources.push({ label: "Implied equity from P/E", kind: "calculation", value: impliedEquityFromPe, ref: "median P/E × subject net income" });
  }

  // --- EV range = min / max of the implied enterprise values computed. ---
  const impliedEvs = [impliedEvFromEbitda, impliedEvFromRevenue].filter((v): v is number => v != null);
  let evRangeLow: number | null = null;
  let evRangeHigh: number | null = null;
  if (impliedEvs.length > 0) {
    evRangeLow = round1(Math.min(...impliedEvs));
    evRangeHigh = round1(Math.max(...impliedEvs));
    sources.push({ label: "Implied EV range", kind: "calculation", value: `${evRangeLow}–${evRangeHigh}`, ref: "min / max of implied EVs" });
  }

  // --- Key risks (deterministic). ---
  if (comparables.length < 3) keyRisks.push("Thin comparable set (<3) — treat as indicative");
  if (impliedEvFromEbitda == null && impliedEvFromRevenue == null && impliedEquityFromPe == null) {
    keyRisks.push("No implied valuation could be triangulated — subject financials and/or comparable multiples are missing.");
  }

  // --- Completeness / confidence / recommendation. ---
  const impliedComputed = [impliedEvFromEbitda, impliedEvFromRevenue, impliedEquityFromPe].filter((v) => v != null).length;
  const completeness = Math.round((impliedComputed / 3) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5 + (comparables.length >= 3 ? 0.1 : 0)));

  const recommendedAction =
    impliedComputed === 0
      ? "Insufficient data to triangulate a valuation — provide subject financials (EBITDA, revenue, or net income) and at least one set of comparable multiples."
      : comparables.length < 3
        ? "Indicative valuation only on a thin comparable set — widen the peer group to at least 3 before relying on the range."
        : "Triangulated valuation range established — advance to an IC memo with these comparables as support.";

  const structured: CompsOutput = {
    multiples: { evEbitda, evRevenue, peRatio },
    impliedValuation: { impliedEvFromEbitda, impliedEvFromRevenue, impliedEquityFromPe, evRangeLow, evRangeHigh },
    missingFields,
    keyRisks,
    recommendedAction,
  };

  const narrative =
    impliedComputed > 0
      ? `Comps for ${subject.companyName}: ` +
        `${evRangeLow != null ? `implied EV ${evRangeLow}–${evRangeHigh}` : "EV not derivable"}` +
        `${impliedEquityFromPe != null ? ` / implied equity ${impliedEquityFromPe} (P/E)` : ""} ` +
        `from ${comparables.length} comparable(s). ` +
        `${missingFields.length ? `Missing: ${missingFields.join(", ")}. ` : ""}Next: ${recommendedAction}`
      : `Comps for ${subject.companyName} not computable — missing ${missingFields.join(", ")}. Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["subject", "comparables"],
  properties: {
    subject: {
      type: "object",
      required: ["companyName"],
      properties: {
        companyName: { type: "string", minLength: 1 },
        ebitda: { type: "number" },
        revenue: { type: "number", minimum: 0 },
        netIncome: { type: "number" },
      },
    },
    comparables: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          evEbitda: { type: "number", minimum: 0 },
          evRevenue: { type: "number", minimum: 0 },
          peRatio: { type: "number", minimum: 0 },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["multiples", "impliedValuation", "recommendedAction"],
  properties: {
    multiples: { type: "object" },
    impliedValuation: { type: "object" },
    missingFields: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const compsManifest: SkillManifest = {
  id: "comps",
  name: "Comparable Company Analysis",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst"],
  supportedEntityTypes: ["deal", "company", "financial_model"],
  requiredInputs: ["subject.companyName", "comparables"],
  optionalInputs: [
    "subject.ebitda",
    "subject.revenue",
    "subject.netIncome",
    "comparables[].evEbitda",
    "comparables[].evRevenue",
    "comparables[].peRatio",
  ],
  outputs: ["multiples", "impliedValuation", "missingFields", "keyRisks", "recommendedAction"],
  artifactTypes: ["analysis", "model"],
  dataPermissions: ["deal:read", "company:read", "financial_model:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated financial values",
    "statistics computed only from provided comparables",
  ],
  evaluationCriteria: [
    "correct median/mean/min/max on golden cases",
    "implied valuation math correct",
    "missing data flagged not invented",
    "thin comparable set risk surfaced",
  ],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const comps: SkillDefinition<CompsInput, CompsOutput> = {
  manifest: compsManifest,
  run,
};
