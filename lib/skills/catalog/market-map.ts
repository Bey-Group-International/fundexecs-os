// lib/skills/catalog/market-map.ts
// Native skill: segment a CALLER-SUPPLIED set of companies into a market map.
// Pure, deterministic core — it ORGANIZES the companies the caller provides into
// segments; it NEVER researches, invents, or enriches companies or market claims.
// The provided company names are `fact` sources (the caller asserted them); the
// grouping is a `calculation`; any narrative is `generated`. An empty company set
// yields an empty map and says so — it does not go looking for companies to fill it.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface MarketMapCompany {
  name: string;
  segment?: string;
  revenue?: number;
  positioning?: string;
}

export interface MarketMapInput {
  sector: string;
  geography?: string;
  companies?: MarketMapCompany[];
}

export interface MarketMapSegment {
  segment: string;
  companies: string[];
  count: number;
}

export interface MarketMapOutput {
  segments: MarketMapSegment[];
  totalCompanies: number;
  segmentCount: number;
  unsegmented: string[];
  missingContext: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const UNSEGMENTED = "Unsegmented";

const run: SkillCore<MarketMapInput, MarketMapOutput> = (input): SkillCoreResult<MarketMapOutput> => {
  const companies = input.companies ?? [];
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  if (!input.geography) missingContext.push("Geography not provided — market map is not geography-scoped");

  // Empty company set — this skill MAPS a provided set; it does not research or
  // fabricate companies. Return an empty map and say so explicitly.
  if (companies.length === 0) {
    missingContext.push(
      "No companies supplied — this skill maps a provided company set; it does not research or fabricate companies.",
    );
    const structured: MarketMapOutput = {
      segments: [],
      totalCompanies: 0,
      segmentCount: 0,
      unsegmented: [],
      missingContext,
      recommendedAction:
        "Supply a set of companies to segment — this skill organizes a company set you provide; it does not source or research companies itself.",
    };
    const narrative =
      `Market map for ${input.sector}: no companies supplied. ` +
      "This skill segments a company set the caller provides — it does not research or fabricate companies. " +
      `Next: ${structured.recommendedAction}`;
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: missingContext };
  }

  // Group companies by their provided segment. Preserve first-seen order within a
  // segment; a company with no segment falls into "Unsegmented" and is flagged.
  const groups = new Map<string, string[]>();
  const unsegmented: string[] = [];

  for (const company of companies) {
    // The company NAME is a fact the caller asserted — recorded as such, never
    // researched or enriched here.
    sources.push({ label: "Provided company", kind: "fact", value: company.name });

    const segment = company.segment ?? UNSEGMENTED;
    if (!company.segment) unsegmented.push(company.name);

    const bucket = groups.get(segment);
    if (bucket) bucket.push(company.name);
    else groups.set(segment, [company.name]);
  }

  // Build segments, then sort by count desc. Ties keep first-seen (insertion)
  // order for determinism.
  const insertionOrder = Array.from(groups.keys());
  const segments: MarketMapSegment[] = insertionOrder
    .map((segment) => ({ segment, companies: groups.get(segment)!, count: groups.get(segment)!.length }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : insertionOrder.indexOf(a.segment) - insertionOrder.indexOf(b.segment)));

  // The grouping itself is a CALCULATION over the provided set, not a fact.
  sources.push({
    label: "Segment grouping",
    kind: "calculation",
    value: `${segments.length} segment(s) over ${companies.length} company(ies)`,
    ref: "group by company.segment",
  });

  const totalCompanies = companies.length;
  const segmentCount = segments.length;

  if (unsegmented.length > 0) {
    missingContext.push(
      `${unsegmented.length} company(ies) have no segment and were grouped under "${UNSEGMENTED}": ${unsegmented.join(", ")}`,
    );
  }

  const recommendedAction =
    unsegmented.length > 0
      ? `Assign a segment to the ${unsegmented.length} unsegmented company(ies), then re-map to refine the market structure.`
      : "Review the segment structure and, if useful, hand the mapped set to source-deals for targeted origination.";

  const structured: MarketMapOutput = {
    segments,
    totalCompanies,
    segmentCount,
    unsegmented,
    missingContext,
    recommendedAction,
  };

  // Completeness = share of companies that arrived with a segment already set.
  const completeness = Math.round(((totalCompanies - unsegmented.length) / totalCompanies) * 100) / 100;
  const confidence = Math.max(0.3, Math.min(0.9, 0.5 + completeness * 0.4));

  const narrative =
    `Market map for ${input.sector}${input.geography ? ` (${input.geography})` : ""}: ` +
    `${totalCompanies} company(ies) organized into ${segmentCount} segment(s). ` +
    "Segments are a grouping of the companies you supplied — no companies or market claims were researched or invented. " +
    (unsegmented.length ? `${unsegmented.length} company(ies) had no segment. ` : "") +
    `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingContext };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["sector"],
  properties: {
    sector: { type: "string", minLength: 1 },
    geography: { type: "string" },
    companies: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          segment: { type: "string" },
          revenue: { type: "number", minimum: 0 },
          positioning: { type: "string" },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["segments", "totalCompanies", "segmentCount", "recommendedAction"],
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        required: ["segment", "companies", "count"],
        properties: {
          segment: { type: "string" },
          companies: { type: "array", items: { type: "string" } },
          count: { type: "number", minimum: 0 },
        },
      },
    },
    totalCompanies: { type: "number", minimum: 0 },
    segmentCount: { type: "number", minimum: 0 },
    unsegmented: { type: "array", items: { type: "string" } },
    missingContext: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const marketMapManifest: SkillManifest = {
  id: "market-map",
  name: "Market Map",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["research"],
  supportedEntityTypes: ["company", "sector", "market_map"],
  requiredInputs: ["sector"],
  optionalInputs: ["geography", "companies"],
  outputs: ["segments", "totalCompanies", "segmentCount", "unsegmented", "missingContext", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["company:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no companies or market claims invented — only the provided set is organized"],
  evaluationCriteria: ["companies grouped by provided segment", "segments sorted by count desc", "unsegmented companies flagged not invented", "empty company set yields empty map with missing-context note"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["source-deals"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document"],
  inputSchema,
  outputSchema,
};

export const marketMap: SkillDefinition<MarketMapInput, MarketMapOutput> = {
  manifest: marketMapManifest,
  run,
};
