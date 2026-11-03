// lib/skills/catalog/financing-terms.ts
// Financing Terms Comparison (PE department · Execution 03). Compares lender term
// sheets like for like: normalises to an annualised all-in cost (method shown),
// ranks cost and flexibility SEPARATELY, checks each against the firm's financing
// policy, and flags the terms that bite in a downside. Every term must cite the
// term-sheet page; an uncited term is marked so. It ranks — the financing lead
// selects the lender group. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { DEFAULT_FINANCING, type FinancingPolicy } from "@/lib/pe/financing-policy";

export interface OfferIn {
  lender: string;
  seniorLeverage: number;
  totalLeverage?: number;
  /** Margin over the base rate, in basis points. */
  marginBps: number;
  /** Upfront fee / OID, percent of facility. */
  upfrontFeePct: number;
  tenorYears: number;
  /** Mandatory amortisation, percent of facility per year. */
  amortPctPerYear: number;
  covenant: "maintenance" | "cov-lite";
  /** Headroom to the sponsor plan at close, percent, for a maintenance covenant. */
  covenantHeadroomPct?: number;
  callProtectionMonths: number;
  equityCure: boolean;
  /** Term-sheet page that supports these terms. */
  sourceRef?: string;
}

export interface FinancingTermsInput {
  /** Base rate assumption, percent. Shared across offers so cost is like for like. */
  baseRatePct: number;
  offers: OfferIn[];
  financing?: FinancingPolicy;
  gateOwner?: string;
}

export interface OfferRow {
  lender: string;
  allInCostPct: number;
  costRank: number;
  flexibilityScore: number;
  flexibilityRank: number;
  policyFlags: string[];
  downsideFlags: string[];
  cited: boolean;
}

export interface FinancingTermsOutput {
  rows: OfferRow[];
  costMethod: string;
  flexibilityMethod: string;
  policyIsDefault: boolean;
  limitation: string;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** 0–5: cov-lite 2 (maintenance 0, +1 when headroom ≥ warn), equity cure 1, call protection ≤ 12m 1, amortisation ≤ 1%/yr 1. */
function flexibility(o: OfferIn, warnPct: number): number {
  let s = 0;
  if (o.covenant === "cov-lite") s += 2;
  else if ((o.covenantHeadroomPct ?? 0) >= warnPct) s += 1;
  if (o.equityCure) s += 1;
  if (o.callProtectionMonths <= 12) s += 1;
  if (o.amortPctPerYear <= 1) s += 1;
  return s;
}

const run: SkillCore<FinancingTermsInput, FinancingTermsOutput> = (input): SkillCoreResult<FinancingTermsOutput> => {
  const sources: SkillSource[] = [{ label: "Base rate", kind: "assumption", value: `${input.baseRatePct}% (shared across offers)` }];
  const missingData: string[] = [];
  const policy = input.financing ?? DEFAULT_FINANCING;
  const policyIsDefault = !input.financing;
  if (policyIsDefault) sources.push({ label: "Financing policy", kind: "assumption", value: "standing default: max senior leverage 4.0x", ref: "run on default settings — set root-financing" });

  const scored = input.offers.map((o) => {
    const allIn = r2(input.baseRatePct + o.marginBps / 100 + (o.tenorYears > 0 ? o.upfrontFeePct / o.tenorYears : 0));
    const policyFlags: string[] = [];
    if (policy.maxSeniorLeverage !== undefined && o.seniorLeverage > policy.maxSeniorLeverage) policyFlags.push(`Senior leverage ${o.seniorLeverage}x exceeds the ${policy.maxSeniorLeverage}x limit.`);
    if (policy.maxTotalLeverage !== undefined && o.totalLeverage !== undefined && o.totalLeverage > policy.maxTotalLeverage) policyFlags.push(`Total leverage ${o.totalLeverage}x exceeds the ${policy.maxTotalLeverage}x limit.`);
    if (policy.maxCallProtectionMonths !== undefined && o.callProtectionMonths > policy.maxCallProtectionMonths) policyFlags.push(`Call protection ${o.callProtectionMonths}m is beyond the ${policy.maxCallProtectionMonths}m the firm resists.`);

    const downsideFlags: string[] = [];
    if (o.covenant === "maintenance") {
      if (o.covenantHeadroomPct === undefined) downsideFlags.push("Maintenance covenant with no headroom stated — cannot judge the downside.");
      else if (o.covenantHeadroomPct < policy.covenantWarnHeadroomPct) downsideFlags.push(`Maintenance covenant headroom ${o.covenantHeadroomPct}% is under the ${policy.covenantWarnHeadroomPct}% warning level.`);
      if (!o.equityCure) downsideFlags.push("Maintenance covenant with no equity cure.");
    }
    if (o.amortPctPerYear > 5) downsideFlags.push(`Amortisation ${o.amortPctPerYear}%/yr drains cash in a downside.`);

    const cited = !!o.sourceRef?.trim();
    if (!cited) missingData.push(`${o.lender}: no term-sheet page cited`);
    return { o, allIn, flex: flexibility(o, policy.covenantWarnHeadroomPct), policyFlags, downsideFlags, cited };
  });

  const byCost = [...scored].sort((a, b) => a.allIn - b.allIn || a.o.lender.localeCompare(b.o.lender));
  const byFlex = [...scored].sort((a, b) => b.flex - a.flex || a.o.lender.localeCompare(b.o.lender));
  const rows: OfferRow[] = byCost.map((s, i) => ({
    lender: s.o.lender,
    allInCostPct: s.allIn,
    costRank: i + 1,
    flexibilityScore: s.flex,
    flexibilityRank: byFlex.findIndex((f) => f === s) + 1,
    policyFlags: s.policyFlags,
    downsideFlags: s.downsideFlags,
    cited: s.cited,
  }));
  for (const r of rows) sources.push({ label: `${r.lender} all-in cost`, kind: "calculation", value: `${r.allInCostPct}%`, ref: "base + margin + upfront fee ÷ tenor" });

  const costMethod = "All-in cost % = base rate + margin (bps ÷ 100) + upfront fee % ÷ tenor years. Straight-line fee; ignores prepayment and hedging.";
  const flexibilityMethod = "Flexibility 0–5: cov-lite +2 (maintenance +1 only if headroom ≥ warning level); equity cure +1; call protection ≤ 12 months +1; amortisation ≤ 1%/yr +1.";
  const gateOwner = input.gateOwner?.trim() || "The financing lead";
  const gate = `${gateOwner} selects the lender group. This note ranks; it does not choose.`;
  const limitation = "Term sheets leave definitions to the credit agreement. Two term sheets with the same covenant level can behave differently.";
  const narrative =
    `Financing terms: ${rows.length} offer(s). Cheapest ${rows[0]?.lender ?? "n/a"} (${rows[0]?.allInCostPct ?? "n/a"}%); most flexible ${byFlex[0]?.o.lender ?? "n/a"} (${byFlex[0]?.flex ?? "n/a"}/5). ` +
    `${rows.filter((r) => r.policyFlags.length).length} offer(s) breach firm policy. ${gate}`;

  const completeness = rows.length ? Math.round((rows.filter((r) => r.cited).length / rows.length) * 100) / 100 : 0;
  return { structured: { rows, costMethod, flexibilityMethod, policyIsDefault, limitation, gate }, narrative, sources, confidence: Math.max(0.3, Math.min(0.85, 0.4 + completeness * 0.4)), completeness, missingData };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["baseRatePct", "offers"],
  properties: {
    baseRatePct: { type: "number", minimum: 0 },
    offers: {
      type: "array",
      items: {
        type: "object",
        required: ["lender", "seniorLeverage", "marginBps", "upfrontFeePct", "tenorYears", "amortPctPerYear", "covenant", "callProtectionMonths", "equityCure"],
        properties: {
          lender: { type: "string", minLength: 1 },
          seniorLeverage: { type: "number", minimum: 0 },
          totalLeverage: { type: "number", minimum: 0 },
          marginBps: { type: "number", minimum: 0 },
          upfrontFeePct: { type: "number", minimum: 0 },
          tenorYears: { type: "number", minimum: 0 },
          amortPctPerYear: { type: "number", minimum: 0 },
          covenant: { type: "string", enum: ["maintenance", "cov-lite"] },
          covenantHeadroomPct: { type: "number" },
          callProtectionMonths: { type: "number", minimum: 0 },
          equityCure: { type: "boolean" },
          sourceRef: { type: "string" },
        },
      },
    },
    financing: { type: "object", properties: { maxSeniorLeverage: { type: "number" }, maxTotalLeverage: { type: "number" }, covenantWarnHeadroomPct: { type: "number" }, maxCallProtectionMonths: { type: "number" } } },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["rows", "costMethod", "flexibilityMethod", "policyIsDefault", "limitation", "gate"],
  properties: {
    rows: { type: "array", items: { type: "object", required: ["lender", "allInCostPct", "costRank", "flexibilityScore", "flexibilityRank", "policyFlags", "downsideFlags", "cited"] } },
    costMethod: { type: "string" },
    flexibilityMethod: { type: "string" },
    policyIsDefault: { type: "boolean" },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const financingTermsManifest: SkillManifest = {
  id: "financing-terms",
  name: "Financing Terms Comparison",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["analyst", "legal_closing"],
  supportedEntityTypes: ["deal"],
  requiredInputs: ["baseRatePct", "offers"],
  optionalInputs: ["financing", "gateOwner"],
  outputs: ["rows", "costMethod", "flexibilityMethod", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "document:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "every term cites a term-sheet page", "all-in cost method shown"],
  evaluationCriteria: ["cost and flexibility ranked separately", "policy breaches flagged", "downside-biting terms flagged", "uncited terms marked"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["bid-range", "ic-memo", "closing-checklist"],
  prohibitedActions: ["sign_document", "move_capital", "submit_term_sheet", "execute_subdoc", "send_outreach"],
  inputSchema,
  outputSchema,
};

export const financingTerms: SkillDefinition<FinancingTermsInput, FinancingTermsOutput> = { manifest: financingTermsManifest, run };
