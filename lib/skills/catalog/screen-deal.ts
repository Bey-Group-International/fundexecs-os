// lib/skills/catalog/screen-deal.ts
// Reference skill: screen an opportunity against a mandate. Pure, deterministic
// core — the tested execution path. It NEVER invents financial values: a missing
// input is FLAGGED, an assumption is LABELLED, and a computed number is marked as
// a calculation. LLM enrichment of the narrative is an optional follow-on that
// wraps this core; the numbers and the verdict come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface MandateCriteria {
  sectors?: string[];
  geographies?: string[];
  minRevenue?: number;
  maxRevenue?: number;
  minEbitda?: number;
  maxEbitda?: number;
  maxEnterpriseValue?: number;
  transactionTypes?: string[];
  exclusions?: string[];
}

export interface DealInput {
  companyName: string;
  sector?: string;
  geography?: string;
  revenue?: number;
  ebitda?: number;
  enterpriseValue?: number;
  askingPrice?: number;
  ownership?: string;
  transactionType?: string;
  description?: string;
}

export interface ScreenDealInput {
  mandate: MandateCriteria;
  deal: DealInput;
}

export type FitStatus = "fit" | "partial" | "miss" | "unknown";

export interface FitScore {
  score: number; // 0–100
  status: FitStatus;
  rationale: string;
}

export interface ScreenDealOutput {
  verdict: "pass" | "watch" | "fail";
  mandateFit: {
    sector: FitScore;
    geography: FitScore;
    size: FitScore;
    overall: number;
  };
  exclusionHits: string[];
  preliminaryValuation: {
    evEbitdaMultiple: number | null;
    impliedFromAsking: number | null;
    band: string;
    note: string;
  };
  leverageConsideration: string;
  keyRisks: string[];
  missingFields: string[];
  diligencePriorities: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const lc = (s: string) => s.toLowerCase().trim();

function listMatch(value: string | undefined, list: string[] | undefined): FitStatus {
  if (!value) return "unknown";
  if (!list || list.length === 0) return "unknown"; // mandate silent on this dimension
  const v = lc(value);
  return list.some((x) => lc(x) === v || v.includes(lc(x)) || lc(x).includes(v)) ? "fit" : "miss";
}

function fitScore(status: FitStatus, dimension: string, value?: string): FitScore {
  const score = status === "fit" ? 100 : status === "partial" ? 60 : status === "miss" ? 0 : 50;
  const rationale =
    status === "unknown"
      ? value
        ? `Mandate does not constrain ${dimension}.`
        : `${dimension} not provided — cannot assess fit.`
      : status === "fit"
        ? `${value} matches the mandate ${dimension}.`
        : `${value} is outside the mandate ${dimension}.`;
  return { score, status, rationale };
}

function sizeFit(deal: DealInput, m: MandateCriteria): FitScore {
  const checks: boolean[] = [];
  const notes: string[] = [];
  if (m.minRevenue != null || m.maxRevenue != null) {
    if (deal.revenue == null) return { score: 50, status: "unknown", rationale: "Revenue not provided — cannot assess size fit." };
    const ok = (m.minRevenue == null || deal.revenue >= m.minRevenue) && (m.maxRevenue == null || deal.revenue <= m.maxRevenue);
    checks.push(ok);
    notes.push(ok ? "revenue in band" : "revenue out of band");
  }
  if (m.minEbitda != null || m.maxEbitda != null) {
    if (deal.ebitda == null) return { score: 50, status: "unknown", rationale: "EBITDA not provided — cannot assess size fit." };
    const ok = (m.minEbitda == null || deal.ebitda >= m.minEbitda) && (m.maxEbitda == null || deal.ebitda <= m.maxEbitda);
    checks.push(ok);
    notes.push(ok ? "EBITDA in band" : "EBITDA out of band");
  }
  if (m.maxEnterpriseValue != null && deal.enterpriseValue != null) {
    const ok = deal.enterpriseValue <= m.maxEnterpriseValue;
    checks.push(ok);
    notes.push(ok ? "EV within ceiling" : "EV above ceiling");
  }
  if (checks.length === 0) return { score: 50, status: "unknown", rationale: "Mandate does not constrain size, or size inputs missing." };
  const passed = checks.filter(Boolean).length;
  const status: FitStatus = passed === checks.length ? "fit" : passed === 0 ? "miss" : "partial";
  return { score: Math.round((passed / checks.length) * 100), status, rationale: notes.join("; ") };
}

const MATERIAL_FIELDS: Array<[keyof DealInput, string]> = [
  ["sector", "Sector"],
  ["geography", "Geography"],
  ["revenue", "Revenue"],
  ["ebitda", "EBITDA"],
  ["enterpriseValue", "Enterprise value"],
  ["ownership", "Ownership"],
  ["transactionType", "Transaction type"],
];

const run: SkillCore<ScreenDealInput, ScreenDealOutput> = (input): SkillCoreResult<ScreenDealOutput> => {
  const { mandate, deal } = input;
  const sources: SkillSource[] = [];

  // Exclusions — a hard gate.
  const haystack = [deal.sector, deal.transactionType, deal.description, deal.geography]
    .filter(Boolean)
    .map((s) => lc(s as string))
    .join(" | ");
  const exclusionHits = (mandate.exclusions ?? []).filter((ex) => haystack.includes(lc(ex)));

  // Dimension fits.
  const sector = fitScore(listMatch(deal.sector, mandate.sectors), "sector", deal.sector);
  const geography = fitScore(listMatch(deal.geography, mandate.geographies), "geography", deal.geography);
  const size = sizeFit(deal, mandate);

  const known = [sector, geography, size].filter((f) => f.status !== "unknown");
  const overall = known.length ? Math.round(known.reduce((s, f) => s + f.score, 0) / known.length) : 0;
  const anyMiss = [sector, geography, size].some((f) => f.status === "miss");

  // Record provided figures as FACTS; nothing is fabricated.
  for (const [key, label] of MATERIAL_FIELDS) {
    const v = deal[key];
    if (v != null && v !== "") sources.push({ label, kind: "fact", value: v as string | number });
  }

  // Preliminary valuation — a CALCULATION only when the inputs exist.
  let evEbitdaMultiple: number | null = null;
  let impliedFromAsking: number | null = null;
  let valuationNote = "";
  if (deal.enterpriseValue != null && deal.ebitda != null && deal.ebitda !== 0) {
    evEbitdaMultiple = Math.round((deal.enterpriseValue / deal.ebitda) * 10) / 10;
    sources.push({ label: "EV / EBITDA multiple", kind: "calculation", value: `${evEbitdaMultiple}x`, ref: "enterpriseValue ÷ ebitda" });
  }
  if (deal.askingPrice != null && deal.ebitda != null && deal.ebitda !== 0) {
    impliedFromAsking = Math.round((deal.askingPrice / deal.ebitda) * 10) / 10;
    sources.push({ label: "Implied multiple (asking price)", kind: "calculation", value: `${impliedFromAsking}x`, ref: "askingPrice ÷ ebitda" });
  }
  const band =
    evEbitdaMultiple != null
      ? `${evEbitdaMultiple}x EV/EBITDA`
      : impliedFromAsking != null
        ? `~${impliedFromAsking}x implied (asking)`
        : "not computable";
  if (evEbitdaMultiple == null && impliedFromAsking == null) {
    valuationNote = "Insufficient data — provide enterprise value or asking price plus EBITDA to compute a multiple.";
  } else {
    valuationNote = "Preliminary multiple only; confirm EBITDA quality and normalization in diligence.";
  }

  // Leverage — an explicit ASSUMPTION, never presented as a fact.
  let leverageConsideration: string;
  if (deal.ebitda != null) {
    const low = Math.round(deal.ebitda * 3);
    const high = Math.round(deal.ebitda * 4.5);
    leverageConsideration = `Indicative debt capacity ~${low}–${high} at 3.0–4.5× EBITDA (ASSUMPTION — market-standard band, confirm with lenders).`;
    sources.push({ label: "Assumed leverage band", kind: "assumption", value: "3.0–4.5× EBITDA" });
  } else {
    leverageConsideration = "EBITDA required to assess leverage capacity.";
  }

  // Missing material fields.
  const missingFields = MATERIAL_FIELDS.filter(([k]) => deal[k] == null || deal[k] === "").map(([, label]) => label);

  // Key risks.
  const keyRisks: string[] = [];
  if (exclusionHits.length) keyRisks.push(`Hits mandate exclusion(s): ${exclusionHits.join(", ")}.`);
  if (sector.status === "miss") keyRisks.push("Sector outside mandate.");
  if (geography.status === "miss") keyRisks.push("Geography outside mandate.");
  if (size.status === "miss") keyRisks.push("Size outside mandate band.");
  if (deal.ebitda == null) keyRisks.push("Leverage and valuation unclear — EBITDA missing.");
  if (evEbitdaMultiple == null && impliedFromAsking == null) keyRisks.push("Valuation not computable from provided data.");
  if (!deal.ownership) keyRisks.push("Ownership / control terms unspecified.");

  // Verdict.
  const completeness = Math.round(((MATERIAL_FIELDS.length - missingFields.length) / MATERIAL_FIELDS.length) * 100) / 100;
  let verdict: ScreenDealOutput["verdict"];
  // A hard size-band miss is disqualifying on its own; a sector/geo fit can't
  // average it back up. Exclusions always fail. Otherwise fail only when a miss
  // coincides with weak overall fit.
  if (exclusionHits.length > 0 || size.status === "miss" || (anyMiss && overall < 50)) verdict = "fail";
  else if (overall >= 70 && !anyMiss && completeness >= 0.6) verdict = "pass";
  else verdict = "watch";

  // Diligence priorities.
  const diligencePriorities: string[] = [];
  if (deal.ebitda == null || deal.revenue == null) diligencePriorities.push("Obtain audited financials (revenue, EBITDA, normalization).");
  if (evEbitdaMultiple == null) diligencePriorities.push("Establish enterprise value / price expectations.");
  if (!deal.ownership) diligencePriorities.push("Clarify ownership, control, and transaction structure.");
  if (sector.status !== "fit") diligencePriorities.push("Validate sector classification against the mandate thesis.");
  if (diligencePriorities.length === 0) diligencePriorities.push("Standard confirmatory diligence across financial, commercial, and legal workstreams.");

  const recommendedAction =
    verdict === "pass"
      ? "Advance to preliminary returns case and open a diligence checklist."
      : verdict === "watch"
        ? "Request the missing data above, then re-screen before committing analyst time."
        : "Decline or park — does not clear the mandate on current information.";

  const structured: ScreenDealOutput = {
    verdict,
    mandateFit: { sector, geography, size, overall },
    exclusionHits,
    preliminaryValuation: { evEbitdaMultiple, impliedFromAsking, band, note: valuationNote },
    leverageConsideration,
    keyRisks,
    missingFields,
    diligencePriorities,
    recommendedAction,
  };

  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5 + (exclusionHits.length ? 0.1 : 0)));

  const narrative =
    `Screen of ${deal.companyName}: ${verdict.toUpperCase()} (mandate fit ${overall}/100). ` +
    `${band === "not computable" ? "Valuation not computable on current data. " : `Preliminary ${band}. `}` +
    `${missingFields.length ? `Missing: ${missingFields.join(", ")}. ` : ""}` +
    `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["mandate", "deal"],
  properties: {
    mandate: {
      type: "object",
      properties: {
        sectors: { type: "array", items: { type: "string" } },
        geographies: { type: "array", items: { type: "string" } },
        minRevenue: { type: "number", minimum: 0 },
        maxRevenue: { type: "number", minimum: 0 },
        minEbitda: { type: "number" },
        maxEbitda: { type: "number" },
        maxEnterpriseValue: { type: "number", minimum: 0 },
        transactionTypes: { type: "array", items: { type: "string" } },
        exclusions: { type: "array", items: { type: "string" } },
      },
    },
    deal: {
      type: "object",
      required: ["companyName"],
      properties: {
        companyName: { type: "string", minLength: 1 },
        sector: { type: "string" },
        geography: { type: "string" },
        revenue: { type: "number", minimum: 0 },
        ebitda: { type: "number" },
        enterpriseValue: { type: "number", minimum: 0 },
        askingPrice: { type: "number", minimum: 0 },
        ownership: { type: "string" },
        transactionType: { type: "string" },
        description: { type: "string" },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["verdict", "mandateFit", "preliminaryValuation", "recommendedAction"],
  properties: {
    verdict: { type: "string", enum: ["pass", "watch", "fail"] },
    mandateFit: {
      type: "object",
      required: ["overall"],
      properties: { overall: { type: "number", minimum: 0, maximum: 100 } },
    },
    exclusionHits: { type: "array", items: { type: "string" } },
    preliminaryValuation: { type: "object" },
    leverageConsideration: { type: "string" },
    keyRisks: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    diligencePriorities: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const screenDealManifest: SkillManifest = {
  id: "screen-deal",
  name: "Deal Screening",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst", "investment_committee", "diligence"],
  supportedEntityTypes: ["deal", "company", "mandate"],
  requiredInputs: ["mandate", "deal.companyName"],
  optionalInputs: ["deal.sector", "deal.geography", "deal.revenue", "deal.ebitda", "deal.enterpriseValue", "deal.askingPrice", "deal.ownership", "deal.transactionType"],
  outputs: ["verdict", "mandateFit", "preliminaryValuation", "keyRisks", "missingFields", "diligencePriorities", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "mandate:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated financial values"],
  evaluationCriteria: ["correct verdict on golden cases", "missing data flagged not invented", "assumptions labelled", "valuation math correct"],
  providerCapabilities: ["structured_extraction", "financial_reasoning"],
  allowedDownstreamSkills: ["returns", "dd-checklist", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const screenDeal: SkillDefinition<ScreenDealInput, ScreenDealOutput> = {
  manifest: screenDealManifest,
  run,
};
