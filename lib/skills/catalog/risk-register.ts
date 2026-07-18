// lib/skills/catalog/risk-register.ts
// Native skill: assemble and SCORE a risk register from a SUPPLIED set of risks.
// Pure, deterministic core — the tested execution path. Like every FundExecs
// skill it NEVER invents information: this skill organizes and scores the risks
// it is GIVEN. It never fabricates a risk. A provided field is a fact
// (kind:"fact"), every risk score is a calculation (kind:"calculation"), a
// missing likelihood/impact/mitigation/owner is FLAGGED per-risk (gaps) and
// rolled up (missingFields), and an empty risk set yields an empty register with
// an explicit note — not an invented one. LLM enrichment of the narrative is an
// optional follow-on that wraps this core; the register, the scores, and the
// severities come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface RiskInput {
  name: string;
  category?: string;
  /** Likelihood on a 1–5 scale. */
  likelihood?: number;
  /** Impact on a 1–5 scale. */
  impact?: number;
  mitigation?: string;
  owner?: string;
}

export interface RiskRegisterInput {
  entityName: string;
  risks?: RiskInput[];
}

export type RiskSeverity = "high" | "medium" | "low" | "unscored";

export interface RegisterEntry {
  name: string;
  category: string | null;
  likelihood: number | null;
  impact: number | null;
  score: number | null;
  severity: RiskSeverity;
  mitigation: string | null;
  owner: string | null;
  gaps: string[];
}

export interface RiskRegisterOutput {
  register: RegisterEntry[];
  highCount: number;
  mediumCount: number;
  lowCount: number;
  unmitigatedCount: number;
  riskCount: number;
  missingFields: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const NO_RISKS_NOTE = "No risks supplied — this skill scores a provided risk set; it does not fabricate risks.";

/** Severity from a risk score (1–25). A null score is 'unscored', never guessed. */
function severityOf(score: number | null): RiskSeverity {
  if (score == null) return "unscored";
  if (score >= 15) return "high";
  if (score >= 8) return "medium";
  return "low";
}

const run: SkillCore<RiskRegisterInput, RiskRegisterOutput> = (input): SkillCoreResult<RiskRegisterOutput> => {
  const sources: SkillSource[] = [];
  const missingFields: string[] = [];

  const { entityName } = input;
  const risks = input.risks ?? [];

  // --- Entity name is the anchor. Absent → FLAGGED, never invented. ---
  if (!entityName) missingFields.push("Entity name");

  // --- Empty risk set → EMPTY register. This skill scores a supplied set; it
  //     never fabricates risks. The absence is noted, not filled in. ---
  if (risks.length === 0) {
    missingFields.push(NO_RISKS_NOTE);
  }

  // --- Assemble each supplied risk. Provided fields are FACTS; the score is a
  //     CALCULATION; missing pieces are FLAGGED per-risk, never guessed. ---
  const register: RegisterEntry[] = risks.map((r) => {
    const likelihood = r.likelihood ?? null;
    const impact = r.impact ?? null;
    const score = likelihood != null && impact != null ? likelihood * impact : null;
    const severity = severityOf(score);
    const category = r.category ?? null;
    const mitigation = r.mitigation ?? null;
    const owner = r.owner ?? null;

    // Provided fields → FACTS. Nothing here is fabricated.
    if (category != null) sources.push({ label: `Risk "${r.name}" category`, kind: "fact", value: category });
    if (likelihood != null) sources.push({ label: `Risk "${r.name}" likelihood`, kind: "fact", value: likelihood });
    if (impact != null) sources.push({ label: `Risk "${r.name}" impact`, kind: "fact", value: impact });
    if (mitigation != null) sources.push({ label: `Risk "${r.name}" mitigation`, kind: "fact", value: mitigation });
    if (owner != null) sources.push({ label: `Risk "${r.name}" owner`, kind: "fact", value: owner });

    const gaps: string[] = [];
    if (score == null) {
      gaps.push("Missing likelihood/impact");
    } else {
      sources.push({ label: `Risk "${r.name}" score`, kind: "calculation", value: score, ref: "likelihood × impact" });
    }
    if (!mitigation) gaps.push("No mitigation");
    if (!owner) gaps.push("No owner");

    // Roll up per-risk scoring gaps into the register-level missing fields.
    if (score == null) missingFields.push(`Risk "${r.name}" — likelihood/impact`);

    return { name: r.name, category, likelihood, impact, score, severity, mitigation, owner, gaps };
  });

  // --- Rank by score desc; unscored risks sort last (stable otherwise). ---
  register.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });

  const highCount = register.filter((e) => e.severity === "high").length;
  const mediumCount = register.filter((e) => e.severity === "medium").length;
  const lowCount = register.filter((e) => e.severity === "low").length;
  const unmitigatedCount = register.filter((e) => !e.mitigation).length;
  const riskCount = register.length;

  // --- Completeness / confidence. ---
  const scoredCount = register.filter((e) => e.score != null).length;
  const completeness = riskCount > 0 ? Math.round((scoredCount / riskCount) * 100) / 100 : 0;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5));

  // --- Recommended action (deterministic). ---
  const recommendedAction =
    riskCount === 0
      ? "No risks supplied — provide a risk set to assemble and score the register."
      : highCount > 0
        ? `Escalate ${highCount} high-severity risk(s) to the risk owner and confirm mitigations before the next review.`
        : unmitigatedCount > 0 || scoredCount < riskCount
          ? "Complete mitigations and likelihood/impact scoring for the flagged risks, then re-run the register."
          : "Register scored — continue periodic monitoring of the risk set.";

  const structured: RiskRegisterOutput = {
    register,
    highCount,
    mediumCount,
    lowCount,
    unmitigatedCount,
    riskCount,
    missingFields,
    recommendedAction,
  };

  const entityLabel = entityName || "(unnamed entity)";
  const narrative =
    riskCount === 0
      ? `Risk register for ${entityLabel}: no risks supplied — nothing to score. This skill organizes and scores a provided risk set; it does not fabricate risks. Next: ${recommendedAction}`
      : `Risk register for ${entityLabel}: ${riskCount} risk(s) scored — ${highCount} high, ${mediumCount} medium, ${lowCount} low` +
        `${scoredCount < riskCount ? `, ${riskCount - scoredCount} unscored` : ""}. ` +
        `${unmitigatedCount ? `${unmitigatedCount} unmitigated. ` : ""}` +
        `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["entityName"],
  properties: {
    entityName: { type: "string", minLength: 1 },
    risks: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          category: { type: "string" },
          likelihood: { type: "number", minimum: 1, maximum: 5 },
          impact: { type: "number", minimum: 1, maximum: 5 },
          mitigation: { type: "string" },
          owner: { type: "string" },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["register", "highCount", "mediumCount", "lowCount", "unmitigatedCount", "riskCount", "missingFields", "recommendedAction"],
  properties: {
    register: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "severity", "gaps"],
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          likelihood: { type: "number", minimum: 1, maximum: 5 },
          impact: { type: "number", minimum: 1, maximum: 5 },
          score: { type: "number", minimum: 1, maximum: 25 },
          severity: { type: "string", enum: ["high", "medium", "low", "unscored"] },
          mitigation: { type: "string" },
          owner: { type: "string" },
          gaps: { type: "array", items: { type: "string" } },
        },
      },
    },
    highCount: { type: "number", minimum: 0 },
    mediumCount: { type: "number", minimum: 0 },
    lowCount: { type: "number", minimum: 0 },
    unmitigatedCount: { type: "number", minimum: 0 },
    riskCount: { type: "number", minimum: 0 },
    missingFields: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const riskRegisterManifest: SkillManifest = {
  id: "risk-register",
  name: "Risk Register",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["risk_compliance"],
  supportedEntityTypes: ["fund", "portfolio_company", "company"],
  requiredInputs: ["entityName"],
  optionalInputs: ["risks"],
  outputs: ["register", "highCount", "mediumCount", "lowCount", "unmitigatedCount", "riskCount", "missingFields", "recommendedAction"],
  artifactTypes: ["risk_report"],
  dataPermissions: ["risk:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated risks — the register scores only the supplied risk set",
    "scores are calculations; provided fields are facts; gaps are flagged not invented",
  ],
  evaluationCriteria: [
    "correct score and severity on golden cases",
    "empty risk set yields an empty register and is flagged, not fabricated",
    "risks ranked by score (unscored last)",
    "missing likelihood/impact/mitigation/owner flagged per risk",
    "severity counts and unmitigated count correct",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["distribute_report", "sign_document"],
  inputSchema,
  outputSchema,
};

export const riskRegister: SkillDefinition<RiskRegisterInput, RiskRegisterOutput> = {
  manifest: riskRegisterManifest,
  run,
};
