// lib/skills/catalog/source-deals.ts
// Native skill: rank a SUPPLIED candidate set against a fund's mandate. Pure,
// deterministic core — the tested execution path. It NEVER invents or fabricates
// companies: it ranks only the candidates the caller provides. A missing candidate
// field is FLAGGED, an empty candidate set returns an empty ranking plus a note.
// Every provided candidate field is a `fact`; every fitScore is a `calculation`.
// LLM enrichment of the narrative is an optional follow-on that wraps this core;
// the ranking and every number come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface SourceMandate {
  sectors?: string[];
  geographies?: string[];
  minRevenue?: number;
  maxRevenue?: number;
  minEbitda?: number;
  maxEbitda?: number;
  exclusions?: string[];
}

export interface CandidateInput {
  name: string;
  sector?: string;
  geography?: string;
  revenue?: number;
  ebitda?: number;
  ownership?: string;
  source?: string;
}

export interface SourceDealsInput {
  mandate: SourceMandate;
  candidates?: CandidateInput[];
}

export interface RankedCandidate {
  name: string;
  fitScore: number; // 0–100
  sector: string | null;
  geography: string | null;
  matchReasons: string[];
  excluded: boolean;
}

export interface SourceDealsOutput {
  ranked: RankedCandidate[];
  topTargets: string[];
  excludedCount: number;
  candidateCount: number;
  missingContext: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

type DimStatus = "fit" | "partial" | "miss" | "unknown";

interface DimFit {
  status: DimStatus;
  score: number; // 0–100, only meaningful when status !== "unknown"
}

const NO_CANDIDATES_NOTE =
  "No candidates supplied — this skill ranks a provided candidate set; it does not fabricate targets.";

const lc = (s: string) => s.toLowerCase().trim();

/** List membership: candidate value against a mandate list. Unknown when either side is silent. */
function listFit(value: string | undefined, list: string[] | undefined): DimFit {
  if (!value) return { status: "unknown", score: 0 };
  if (!list || list.length === 0) return { status: "unknown", score: 0 }; // mandate silent
  const v = lc(value);
  const hit = list.some((x) => lc(x) === v || v.includes(lc(x)) || lc(x).includes(v));
  return hit ? { status: "fit", score: 100 } : { status: "miss", score: 0 };
}

/** Size fit across the revenue / EBITDA bands the mandate constrains and the candidate provides. */
function sizeFit(c: CandidateInput, m: SourceMandate): DimFit {
  const checks: boolean[] = [];
  if (m.minRevenue != null || m.maxRevenue != null) {
    if (c.revenue != null) {
      checks.push((m.minRevenue == null || c.revenue >= m.minRevenue) && (m.maxRevenue == null || c.revenue <= m.maxRevenue));
    }
  }
  if (m.minEbitda != null || m.maxEbitda != null) {
    if (c.ebitda != null) {
      checks.push((m.minEbitda == null || c.ebitda >= m.minEbitda) && (m.maxEbitda == null || c.ebitda <= m.maxEbitda));
    }
  }
  if (checks.length === 0) return { status: "unknown", score: 0 }; // mandate silent on size, or no figures supplied
  const passed = checks.filter(Boolean).length;
  const score = Math.round((passed / checks.length) * 100);
  const status: DimStatus = passed === checks.length ? "fit" : passed === 0 ? "miss" : "partial";
  return { status, score };
}

const run: SkillCore<SourceDealsInput, SourceDealsOutput> = (input): SkillCoreResult<SourceDealsOutput> => {
  const mandate = input.mandate ?? {};
  const candidates = input.candidates ?? [];
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // GUARDRAIL: an empty candidate set is NEVER filled in. Return an empty ranking
  // and say so — this skill ranks what it is given, it does not invent targets.
  if (candidates.length === 0) {
    missingContext.push(NO_CANDIDATES_NOTE);
    const structured: SourceDealsOutput = {
      ranked: [],
      topTargets: [],
      excludedCount: 0,
      candidateCount: 0,
      missingContext,
      recommendedAction:
        "Supply a candidate set (sourcing list, CRM export, or research pull) — this skill ranks provided targets, it does not generate them.",
    };
    const narrative =
      "No candidates supplied. This skill ranks a provided candidate set against the mandate; it does not fabricate targets. Provide candidates to rank.";
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: [...missingContext] };
  }

  const exclusions = mandate.exclusions ?? [];
  const mandateSilentOnSector = !mandate.sectors || mandate.sectors.length === 0;
  const mandateSilentOnGeography = !mandate.geographies || mandate.geographies.length === 0;
  const mandateSilentOnSize =
    mandate.minRevenue == null && mandate.maxRevenue == null && mandate.minEbitda == null && mandate.maxEbitda == null;

  let knownDimTotal = 0;
  let knownDimPossible = 0;
  const missingFinancials: string[] = [];

  const ranked: RankedCandidate[] = candidates.map((c) => {
    // Record provided fields as FACTS — nothing is fabricated.
    if (c.sector) sources.push({ label: `${c.name} — sector`, kind: "fact", value: c.sector });
    if (c.geography) sources.push({ label: `${c.name} — geography`, kind: "fact", value: c.geography });
    if (c.revenue != null) sources.push({ label: `${c.name} — revenue`, kind: "fact", value: c.revenue });
    if (c.ebitda != null) sources.push({ label: `${c.name} — EBITDA`, kind: "fact", value: c.ebitda });
    if (c.ownership) sources.push({ label: `${c.name} — ownership`, kind: "fact", value: c.ownership });
    if (c.source) sources.push({ label: `${c.name} — source`, kind: "fact", value: c.source });

    // Exclusions — a hard gate. Substring match across sector / source / name.
    const haystack = [c.sector, c.source, c.name].filter(Boolean).map((s) => lc(s as string)).join(" | ");
    const exclusionHits = exclusions.filter((ex) => haystack.includes(lc(ex)));
    const excluded = exclusionHits.length > 0;

    const sector = listFit(c.sector, mandate.sectors);
    const geography = listFit(c.geography, mandate.geographies);
    const size = sizeFit(c, mandate);

    const known = [sector, geography, size].filter((d) => d.status !== "unknown");
    knownDimTotal += known.length;
    knownDimPossible += 3;
    if (!missingFinancials.includes(c.name) && !mandateSilentOnSize && size.status === "unknown") missingFinancials.push(c.name);

    // fitScore = average of KNOWN dimension fits. Excluded candidates are forced low.
    const rawScore = known.length ? Math.round(known.reduce((s, d) => s + d.score, 0) / known.length) : 0;
    const fitScoreValue = excluded ? 0 : rawScore;

    // Human-readable match reasons.
    const matchReasons: string[] = [];
    if (sector.status === "fit") matchReasons.push("Sector match");
    else if (sector.status === "miss") matchReasons.push("Sector outside mandate");
    if (geography.status === "fit") matchReasons.push("Geography match");
    else if (geography.status === "miss") matchReasons.push("Geography outside mandate");
    if (size.status === "fit") matchReasons.push("Size in band");
    else if (size.status === "partial") matchReasons.push("Size partially in band");
    else if (size.status === "miss") matchReasons.push("Size out of band");
    if (excluded) matchReasons.push(`Excluded: ${exclusionHits.join(", ")}`);
    if (matchReasons.length === 0) matchReasons.push("Insufficient data to score against mandate");

    // fitScore is a CALCULATION, never a fact.
    sources.push({ label: `${c.name} — fit score`, kind: "calculation", value: fitScoreValue, ref: "average of known dimension fits" });

    return {
      name: c.name,
      fitScore: fitScoreValue,
      sector: c.sector ?? null,
      geography: c.geography ?? null,
      matchReasons,
      excluded,
    };
  });

  // Rank: non-excluded first, by fitScore desc; excluded always last.
  ranked.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    return b.fitScore - a.fitScore;
  });

  const excludedCount = ranked.filter((r) => r.excluded).length;
  const topTargets = ranked.filter((r) => !r.excluded).slice(0, 5).map((r) => r.name);

  // Missing-context notes — surfaced, never silently assumed.
  if (mandateSilentOnSector) missingContext.push("Mandate does not constrain sector — sector fit not scored.");
  if (mandateSilentOnGeography) missingContext.push("Mandate does not constrain geography — geography fit not scored.");
  if (mandateSilentOnSize) missingContext.push("Mandate does not constrain size (revenue / EBITDA) — size fit not scored.");
  if (missingFinancials.length)
    missingContext.push(`Financials missing for ${missingFinancials.length} candidate(s) — size fit could not be assessed for them.`);
  if (topTargets.length === 0 && excludedCount === candidates.length)
    missingContext.push("Every supplied candidate hit a mandate exclusion — no rankable targets remain.");

  const completeness = knownDimPossible ? Math.round((knownDimTotal / knownDimPossible) * 100) / 100 : 0;
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5 + (excludedCount ? 0.05 : 0)));

  const recommendedAction =
    topTargets.length > 0
      ? `Advance the top ${topTargets.length} target(s) (${topTargets.join(", ")}) to screen-deal for a full mandate screen.`
      : "No candidate cleared the mandate — broaden the sourcing pull or revisit the mandate criteria before screening.";

  const narrative =
    `Ranked ${candidates.length} supplied candidate(s) against the mandate` +
    `${excludedCount ? `, ${excludedCount} excluded` : ""}. ` +
    `${topTargets.length ? `Top: ${topTargets.join(", ")}. ` : "No rankable targets. "}` +
    `Next: ${recommendedAction}`;

  const structured: SourceDealsOutput = {
    ranked,
    topTargets,
    excludedCount,
    candidateCount: candidates.length,
    missingContext,
    recommendedAction,
  };

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingContext] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["mandate"],
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
        exclusions: { type: "array", items: { type: "string" } },
      },
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          sector: { type: "string" },
          geography: { type: "string" },
          revenue: { type: "number", minimum: 0 },
          ebitda: { type: "number" },
          ownership: { type: "string" },
          source: { type: "string" },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["ranked", "topTargets", "excludedCount", "candidateCount", "recommendedAction"],
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "fitScore", "excluded"],
        properties: {
          name: { type: "string" },
          fitScore: { type: "number", minimum: 0, maximum: 100 },
          sector: { type: "string" },
          geography: { type: "string" },
          matchReasons: { type: "array", items: { type: "string" } },
          excluded: { type: "boolean" },
        },
      },
    },
    topTargets: { type: "array", items: { type: "string" } },
    excludedCount: { type: "number", minimum: 0 },
    candidateCount: { type: "number", minimum: 0 },
    missingContext: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const sourceDealsManifest: SkillManifest = {
  id: "source-deals",
  name: "Deal Sourcing (Rank Candidates)",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["deal_sourcer"],
  supportedEntityTypes: ["mandate", "company", "deal"],
  requiredInputs: ["mandate"],
  optionalInputs: ["candidates"],
  outputs: ["ranked", "topTargets", "excludedCount", "candidateCount", "missingContext", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["company:read", "deal:read", "mandate:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated candidates"],
  evaluationCriteria: [
    "ranks only supplied candidates",
    "empty candidate set returns empty ranking with a note, never invents targets",
    "excluded candidates ranked last",
    "provided fields labelled fact, fitScore labelled calculation",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["screen-deal"],
  prohibitedActions: ["send_outreach", "send_intro_request", "sign_document"],
  inputSchema,
  outputSchema,
};

export const sourceDeals: SkillDefinition<SourceDealsInput, SourceDealsOutput> = {
  manifest: sourceDealsManifest,
  run,
};
