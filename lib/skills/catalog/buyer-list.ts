// lib/skills/catalog/buyer-list.ts
// Native skill: rank a SUPPLIED set of buyers / acquirers for a sale process.
// Pure, deterministic core — the tested execution path. It NEVER invents buyers:
// it ranks only the candidates the caller provides. An empty buyer set returns an
// empty ranking plus an explicit missingContext note. Provided fields are FACTS;
// every fitScore is a CALCULATION. LLM enrichment of the narrative is an optional
// follow-on that wraps this core; the ranking and the numbers come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type BuyerType = "strategic" | "financial" | "sponsor";

export interface BuyerCompany {
  name: string;
  sector?: string;
  geography?: string;
  ebitda?: number;
}

export interface BuyerCandidate {
  name: string;
  type?: BuyerType;
  rationale?: string;
  sector?: string;
  geography?: string;
  aum?: number;
}

export interface BuyerListInput {
  company: BuyerCompany;
  buyers?: BuyerCandidate[];
}

export interface RankedBuyer {
  name: string;
  type: string | null;
  fitScore: number; // 0–100
  rationale: string | null;
  matchReasons: string[];
}

export interface BuyerTypeCounts {
  strategic: number;
  financial: number;
  sponsor: number;
  unknown: number;
}

export interface BuyerListOutput {
  ranked: RankedBuyer[];
  byType: BuyerTypeCounts;
  topBuyers: string[];
  buyerCount: number;
  missingContext: string[];
  recommendedAction: string;
}

// The single guardrail message — this skill ranks a provided set, never fabricates one.
export const NO_BUYERS_MESSAGE =
  "No buyers supplied — this skill ranks a provided buyer set; it does not fabricate buyers.";

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const lc = (s: string) => s.toLowerCase().trim();

function overlaps(a: string, b: string): boolean {
  const x = lc(a);
  const y = lc(b);
  return x === y || x.includes(y) || y.includes(x);
}

interface Scored {
  fitScore: number;
  matchReasons: string[];
  signalCount: number;
}

function scoreBuyer(buyer: BuyerCandidate, company: BuyerCompany): Scored {
  const reasons: string[] = [];
  const signals: number[] = [];

  // Sector overlap — a signal only when BOTH sides declare a sector.
  let sectorMatch: boolean | undefined;
  if (company.sector && buyer.sector) {
    sectorMatch = overlaps(company.sector, buyer.sector);
    signals.push(sectorMatch ? 100 : 0);
    reasons.push(
      sectorMatch
        ? `Sector match (${buyer.sector})`
        : `Sector mismatch (${buyer.sector} vs ${company.sector})`
    );
  }

  // Geography overlap — a signal only when BOTH sides declare a geography.
  if (company.geography && buyer.geography) {
    const geoMatch = overlaps(company.geography, buyer.geography);
    signals.push(geoMatch ? 100 : 0);
    reasons.push(
      geoMatch
        ? `Geography match (${buyer.geography})`
        : `Geography mismatch (${buyer.geography} vs ${company.geography})`
    );
  }

  // Type bonus — a strategic in the same sector, or a financial/sponsor with
  // disclosed AUM (capital to deploy). Only counts as a signal when assessable.
  if (buyer.type === "strategic") {
    if (sectorMatch === true) {
      signals.push(100);
      reasons.push("Strategic acquirer in the same sector");
    } else if (sectorMatch === false) {
      signals.push(0);
      reasons.push("Strategic acquirer outside the target sector");
    }
  } else if (buyer.type === "financial" || buyer.type === "sponsor") {
    if (buyer.aum != null) {
      signals.push(100);
      reasons.push(`${buyer.type} buyer with disclosed AUM (${buyer.aum})`);
    }
  }

  if (signals.length === 0) reasons.push("Insufficient overlap data to score fit");

  const fitScore = signals.length ? Math.round(signals.reduce((s, v) => s + v, 0) / signals.length) : 0;
  return { fitScore, matchReasons: reasons, signalCount: signals.length };
}

const run: SkillCore<BuyerListInput, BuyerListOutput> = (input): SkillCoreResult<BuyerListOutput> => {
  const { company } = input;
  const buyers = input.buyers ?? [];
  const sources: SkillSource[] = [];

  // Record provided company context as FACTS — nothing is fabricated.
  sources.push({ label: "Company", kind: "fact", value: company.name });
  if (company.sector) sources.push({ label: "Company sector", kind: "fact", value: company.sector });
  if (company.geography) sources.push({ label: "Company geography", kind: "fact", value: company.geography });
  if (company.ebitda != null) sources.push({ label: "Company EBITDA", kind: "fact", value: company.ebitda });

  const byType: BuyerTypeCounts = { strategic: 0, financial: 0, sponsor: 0, unknown: 0 };

  // Score, preserving input order for a stable tie-break, then rank by fit desc.
  const scored = buyers.map((buyer, index) => {
    const s = scoreBuyer(buyer, company);
    if (buyer.type === "strategic") byType.strategic += 1;
    else if (buyer.type === "financial") byType.financial += 1;
    else if (buyer.type === "sponsor") byType.sponsor += 1;
    else byType.unknown += 1;

    // The provided type/rationale are FACTS; the fitScore is a CALCULATION.
    if (buyer.type) sources.push({ label: `Buyer type — ${buyer.name}`, kind: "fact", value: buyer.type });
    sources.push({
      label: `Fit score — ${buyer.name}`,
      kind: "calculation",
      value: s.fitScore,
      ref: "average of known sector / geography / type signals",
    });

    return { buyer, index, ...s };
  });

  scored.sort((a, b) => (b.fitScore - a.fitScore) || (a.index - b.index));

  const ranked: RankedBuyer[] = scored.map(({ buyer, fitScore, matchReasons }) => ({
    name: buyer.name,
    type: buyer.type ?? null,
    fitScore,
    rationale: buyer.rationale ?? null,
    matchReasons,
  }));

  const topBuyers = ranked.slice(0, 5).map((b) => b.name);

  // Missing context — flag gaps; never invent buyers to fill them.
  const missingContext: string[] = [];
  if (buyers.length === 0) {
    missingContext.push(NO_BUYERS_MESSAGE);
  } else {
    if (!company.sector) missingContext.push("Company sector not provided — sector fit could not be scored for any buyer.");
    if (!company.geography) missingContext.push("Company geography not provided — geography fit could not be scored for any buyer.");
    const unscored = scored.filter((s) => s.signalCount === 0).length;
    if (unscored > 0) missingContext.push(`${unscored} buyer(s) had no overlapping attributes to score — enrich their sector, geography, type, or AUM.`);
    if (byType.unknown > 0) missingContext.push(`${byType.unknown} buyer(s) have no declared type (strategic / financial / sponsor).`);
  }

  const recommendedAction =
    buyers.length === 0
      ? "Provide a set of candidate buyers to rank — this skill prioritizes a supplied acquirer set and does not source or fabricate buyers."
      : topBuyers.length > 0
        ? `Prioritize outreach preparation for the top ${topBuyers.length} buyer(s) by fit (${topBuyers.join(", ")}); enrich missing sector/geography/AUM to sharpen the ranking before approaching any counterparty.`
        : "Enrich the supplied buyers with sector, geography, type, or AUM so the set can be ranked.";

  const structured: BuyerListOutput = {
    ranked,
    byType,
    topBuyers,
    buyerCount: buyers.length,
    missingContext,
    recommendedAction,
  };

  // Completeness — how much signal data the supplied set carried (0 when empty).
  const completeness =
    buyers.length === 0
      ? 0
      : Math.round((scored.reduce((s, b) => s + Math.min(b.signalCount, 3) / 3, 0) / buyers.length) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.95, 0.35 + completeness * 0.5 + (buyers.length ? 0.1 : 0)));

  const narrative =
    buyers.length === 0
      ? `Buyer ranking for ${company.name}: no candidate buyers were supplied. ${NO_BUYERS_MESSAGE} ${recommendedAction}`
      : `Ranked ${buyers.length} candidate buyer(s) for ${company.name} ` +
        `(${byType.strategic} strategic, ${byType.financial} financial, ${byType.sponsor} sponsor, ${byType.unknown} untyped). ` +
        `Top by fit: ${topBuyers.join(", ")}. ` +
        `${missingContext.length ? `Gaps: ${missingContext.join(" ")} ` : ""}` +
        `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingContext };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company"],
  properties: {
    company: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        sector: { type: "string" },
        geography: { type: "string" },
        ebitda: { type: "number" },
      },
    },
    buyers: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          type: { type: "string", enum: ["strategic", "financial", "sponsor"] },
          rationale: { type: "string" },
          sector: { type: "string" },
          geography: { type: "string" },
          aum: { type: "number", minimum: 0 },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["ranked", "byType", "topBuyers", "buyerCount", "missingContext", "recommendedAction"],
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "fitScore", "matchReasons"],
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          fitScore: { type: "number", minimum: 0, maximum: 100 },
          rationale: { type: "string" },
          matchReasons: { type: "array", items: { type: "string" } },
        },
      },
    },
    byType: {
      type: "object",
      required: ["strategic", "financial", "sponsor", "unknown"],
      properties: {
        strategic: { type: "number", minimum: 0 },
        financial: { type: "number", minimum: 0 },
        sponsor: { type: "number", minimum: 0 },
        unknown: { type: "number", minimum: 0 },
      },
    },
    topBuyers: { type: "array", items: { type: "string" } },
    buyerCount: { type: "number", minimum: 0 },
    missingContext: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const buyerListManifest: SkillManifest = {
  id: "buyer-list",
  name: "Buyer List (Rank Acquirers)",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["deal_sourcer"],
  supportedEntityTypes: ["company", "buyer"],
  requiredInputs: ["company.name"],
  optionalInputs: ["company.sector", "company.geography", "company.ebitda", "buyers"],
  outputs: ["ranked", "byType", "topBuyers", "buyerCount", "missingContext", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["company:read", "buyer:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "never fabricates buyers — ranks only the supplied set",
  ],
  evaluationCriteria: [
    "ranks by fitScore descending",
    "empty buyer set returns empty ranked with the missingContext guardrail",
    "provided fields labelled fact, fitScore labelled calculation",
    "byType counts strategic / financial / sponsor / unknown correctly",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["send_outreach", "share_materials", "sign_document"],
  inputSchema,
  outputSchema,
};

export const buyerList: SkillDefinition<BuyerListInput, BuyerListOutput> = {
  manifest: buyerListManifest,
  run,
};
