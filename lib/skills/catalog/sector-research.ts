// lib/skills/catalog/sector-research.ts
// Native skill: organize a CALLER-SUPPLIED body of research points into a
// structured sector brief. Pure, deterministic core — it GROUPS the findings the
// caller provides (by category), grades each finding's source quality, and FLAGS
// any claim that arrives without a source. It NEVER invents facts, figures, or
// market data, and it NEVER manufactures a source.
//
// The Research review standard is load-bearing: EVERY material claim must carry a
// supplied source. A claim WITH a source is a `fact` (it carries its source ref);
// a claim WITHOUT a source is still surfaced but marked unsupported and emitted as
// a `generated` (flagged) item — never as a fact. The source-quality grade is a
// `calculation`. An empty finding set yields an empty brief and says so.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type FindingCategory = "driver" | "risk" | "trend" | "player" | "sizing";
export type FindingSourceType = "primary" | "secondary" | "expert" | "news" | "unknown";

export interface SectorFinding {
  claim: string;
  category: FindingCategory;
  source?: string;
  sourceType?: FindingSourceType;
}

export interface SectorResearchInput {
  sector: string;
  findings?: SectorFinding[];
}

export interface BriefFinding {
  claim: string;
  source: string | null;
  grade: string;
}

export interface BriefSection {
  category: string;
  findings: BriefFinding[];
}

export interface SectorResearchOutput {
  sector: string;
  sections: BriefSection[];
  sourcedCount: number;
  unsourcedCount: number;
  unsupportedClaims: string[];
  sourceQuality: string;
  recommendedAction: string;
  missingContext: string[];
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const NO_FINDINGS_NOTE =
  "No findings supplied — this skill organizes provided research; it does not fabricate market data.";

// Category display order — a stable, first-class ordering for the brief.
const CATEGORY_ORDER: FindingCategory[] = ["driver", "risk", "trend", "player", "sizing"];

/** Source-quality grade for a finding, keyed off its supplied sourceType. A claim
 * with NO source is the lowest grade regardless of any claimed sourceType — an
 * unsupported claim cannot be graded as though it were sourced. */
function gradeFor(hasSource: boolean, sourceType?: FindingSourceType): string {
  if (!hasSource) return "D";
  switch (sourceType) {
    case "primary":
      return "A";
    case "expert":
      return "B";
    case "secondary":
      return "C";
    case "news":
      return "C";
    default:
      return "D"; // "unknown" or absent
  }
}

const run: SkillCore<SectorResearchInput, SectorResearchOutput> = (input): SkillCoreResult<SectorResearchOutput> => {
  const findings = input.findings ?? [];
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // GUARDRAIL: an empty (or omitted) finding set is NEVER filled in. This skill
  // ORGANIZES provided research — it does not research or fabricate market data.
  if (findings.length === 0) {
    missingContext.push(NO_FINDINGS_NOTE);
    const structured: SectorResearchOutput = {
      sector: input.sector,
      sections: [],
      sourcedCount: 0,
      unsourcedCount: 0,
      unsupportedClaims: [],
      sourceQuality: "N/A — no findings supplied",
      recommendedAction:
        "Supply a body of research findings (each with a source) — this skill organizes and source-checks provided research; it does not fabricate market data.",
      missingContext,
    };
    const narrative =
      `Sector brief for ${input.sector}: no findings supplied. ` +
      "This skill organizes and source-checks research the caller provides — it does not fabricate facts, figures, or market data. " +
      `Next: ${structured.recommendedAction}`;
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: [...missingContext] };
  }

  // Group findings by category, preserving a stable category order. Each finding
  // is graded; a sourced claim is a FACT carrying its ref, an unsourced claim is a
  // GENERATED (flagged) item and joins unsupportedClaims — never a fact.
  const groups = new Map<string, BriefFinding[]>();
  const unsupportedClaims: string[] = [];
  const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  let sourcedCount = 0;
  let unsourcedCount = 0;

  for (const finding of findings) {
    const hasSource = typeof finding.source === "string" && finding.source.trim().length > 0;
    const grade = gradeFor(hasSource, finding.sourceType);
    gradeCounts[grade] = (gradeCounts[grade] ?? 0) + 1;

    if (hasSource) {
      sourcedCount += 1;
      // A supplied, sourced claim is a FACT — it carries the caller's source ref.
      sources.push({ label: `${finding.category} — ${finding.claim}`, kind: "fact", value: finding.claim, ref: finding.source });
    } else {
      unsourcedCount += 1;
      unsupportedClaims.push(finding.claim);
      // An unsourced claim is surfaced but FLAGGED as generated — never a fact, and
      // NEVER given an invented source.
      sources.push({ label: `${finding.category} — ${finding.claim} (unsupported)`, kind: "generated", value: finding.claim });
    }

    const briefFinding: BriefFinding = {
      claim: finding.claim,
      source: hasSource ? (finding.source as string) : null,
      grade,
    };
    const bucket = groups.get(finding.category);
    if (bucket) bucket.push(briefFinding);
    else groups.set(finding.category, [briefFinding]);
  }

  // Build sections in the canonical category order, then append any unexpected
  // categories in first-seen order (defensive — the schema constrains category).
  const seen = Array.from(groups.keys());
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => groups.has(c)),
    ...seen.filter((c) => !CATEGORY_ORDER.includes(c as FindingCategory)),
  ];
  const sections: BriefSection[] = orderedCategories.map((category) => ({ category, findings: groups.get(category)! }));

  // Overall source quality = grade distribution + a coarse majority grade. This is
  // a CALCULATION over the findings, never a fact.
  const total = findings.length;
  const coarse = (["A", "B", "C", "D"] as const).reduce((best, g) => (gradeCounts[g] > gradeCounts[best] ? g : best), "D");
  const distribution = `A:${gradeCounts.A}, B:${gradeCounts.B}, C:${gradeCounts.C}, D:${gradeCounts.D}`;
  const sourceQuality = `${coarse} (${distribution})`;
  sources.push({ label: "Source quality", kind: "calculation", value: sourceQuality, ref: "grade distribution over supplied findings" });

  if (unsourcedCount > 0) {
    missingContext.push(
      `${unsourcedCount} claim(s) lack a source and are flagged unsupported — no source was invented for them.`,
    );
  }

  const recommendedAction =
    unsourcedCount > 0
      ? `${unsourcedCount} claim(s) lack a source — obtain support before the brief is relied upon.`
      : "Every claim carries a source — review the graded brief and, if useful, hand the mapped sector to market-map or source-deals.";

  // Completeness = share of claims that arrived with a source. Low when many are
  // unsupported — the brief cannot be relied upon until its claims are sourced.
  const completeness = Math.round((sourcedCount / total) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.6));

  const narrative =
    `Sector brief for ${input.sector}: ${total} finding(s) organized into ${sections.length} section(s). ` +
    `${sourcedCount} sourced, ${unsourcedCount} unsupported (source quality ${sourceQuality}). ` +
    "Findings are the research you supplied — no facts, figures, or market data were invented, and no source was manufactured. " +
    (unsourcedCount ? `${unsourcedCount} claim(s) are flagged unsupported. ` : "") +
    `Next: ${recommendedAction}`;

  const structured: SectorResearchOutput = {
    sector: input.sector,
    sections,
    sourcedCount,
    unsourcedCount,
    unsupportedClaims,
    sourceQuality,
    recommendedAction,
    missingContext,
  };

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingContext] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["sector"],
  properties: {
    sector: { type: "string", minLength: 1 },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["claim", "category"],
        properties: {
          claim: { type: "string", minLength: 1 },
          category: { type: "string", enum: ["driver", "risk", "trend", "player", "sizing"] },
          source: { type: "string" },
          sourceType: { type: "string", enum: ["primary", "secondary", "expert", "news", "unknown"] },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["sector", "sections", "sourcedCount", "unsourcedCount", "unsupportedClaims", "sourceQuality", "recommendedAction"],
  properties: {
    sector: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["category", "findings"],
        properties: {
          category: { type: "string" },
          findings: {
            type: "array",
            items: {
              type: "object",
              required: ["claim", "grade"],
              properties: {
                claim: { type: "string" },
                source: { type: "string" },
                grade: { type: "string" },
              },
            },
          },
        },
      },
    },
    sourcedCount: { type: "number", minimum: 0 },
    unsourcedCount: { type: "number", minimum: 0 },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    sourceQuality: { type: "string" },
    recommendedAction: { type: "string" },
    missingContext: { type: "array", items: { type: "string" } },
  },
};

export const sectorResearchManifest: SkillManifest = {
  id: "sector-research",
  name: "Sector Research Brief",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["research"],
  supportedEntityTypes: ["sector", "research", "market_map"],
  requiredInputs: ["sector"],
  optionalInputs: ["findings"],
  outputs: ["sector", "sections", "sourcedCount", "unsourcedCount", "unsupportedClaims", "sourceQuality", "recommendedAction", "missingContext"],
  artifactTypes: ["analysis"],
  dataPermissions: ["company:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no facts, figures, or market data invented — only the supplied findings are organized",
    "every material claim must carry a supplied source; a claim with no source is flagged unsupported",
  ],
  evaluationCriteria: [
    "findings grouped by category into sections",
    "a sourced claim is a fact carrying its source ref",
    "an unsourced claim is flagged in unsupportedClaims and never emitted as a fact",
    "source-quality grade follows sourceType (primary A, expert B, secondary/news C, unknown/absent D)",
    "empty finding set yields an empty brief with the no-fabrication note",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["market-map", "source-deals"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document"],
  inputSchema,
  outputSchema,
};

export const sectorResearch: SkillDefinition<SectorResearchInput, SectorResearchOutput> = {
  manifest: sectorResearchManifest,
  run,
};
