// lib/skills/catalog/audit-statement.ts
// Native skill: prepare AUDIT SUPPORT by tying out caller-SUPPLIED financial-
// statement line items against their supporting schedules / GL balances. Pure,
// deterministic core — the tested execution path. Like every FundExecs skill it
// NEVER invents a balance: a line with no supporting value is FLAGGED "unsupported"
// with a null variance (it is NEVER assumed to equal the statement value), a
// provided figure is a fact (kind:"fact"), and every computed variance is a
// calculation (kind:"calculation"). A defaulted materiality threshold is an
// assumption (kind:"assumption").
//
// GUARDRAIL: this skill PREPARES audit support for review. It NEVER issues an
// audit opinion, NEVER signs off, and NEVER posts an entry — those belong to the
// external auditor / a human (post_journal_entry, close_period, move_capital,
// sign_document are all prohibited on this manifest). Nothing here mutates the books.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface StatementLine {
  label: string;
  /** The value as it appears on the financial statement. */
  statementValue: number;
  /** The value per the supporting schedule / GL balance. Absent → unsupported. */
  supportValue?: number;
  /** The supporting schedule this line ties to (e.g. "AR aging", "GL 1000"). */
  schedule?: string;
}

export interface AuditStatementInput {
  statementLines?: StatementLine[];
  /** Variances at/under this are "tied within materiality"; default 0 (exact tie). */
  materialityThreshold?: number;
}

export interface TieOut {
  label: string;
  statementValue: number;
  /** null when no supporting value was supplied — never assumed. */
  supportValue: number | null;
  /** round(statementValue − supportValue, 2), or null when support is missing. */
  variance: number | null;
  /** "tied" | "variance" | "unsupported". */
  status: string;
  schedule: string | null;
}

export interface AuditStatementOutput {
  tieOuts: TieOut[];
  tiedCount: number;
  varianceCount: number;
  unsupportedCount: number;
  /** Σ|variance| over supported lines. */
  totalAbsVariance: number;
  recommendedAction: string;
  missingContext: string[];
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

const NO_LINES_NOTE =
  "No statement lines supplied — this skill ties out provided lines against support; it does not fabricate balances.";

const run: SkillCore<AuditStatementInput, AuditStatementOutput> = (input): SkillCoreResult<AuditStatementOutput> => {
  const statementLines = input.statementLines ?? [];
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // GUARDRAIL: no statement lines are NEVER fabricated. Return an empty tie-out and
  // say so — this skill ties out what it is given, it does not invent balances.
  if (statementLines.length === 0) {
    missingContext.push(NO_LINES_NOTE);
    const structured: AuditStatementOutput = {
      tieOuts: [],
      tiedCount: 0,
      varianceCount: 0,
      unsupportedCount: 0,
      totalAbsVariance: 0,
      recommendedAction:
        "Supply the statement line items and their supporting schedule / GL values to prepare the tie-out — this skill ties out provided lines, it does not fabricate balances or issue an audit opinion.",
      missingContext,
    };
    const narrative =
      "No statement lines supplied. This skill ties out provided line items against their supporting schedules; it does not fabricate balances or issue an audit opinion. Provide statement lines to tie out.";
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: [...missingContext] };
  }

  // Materiality threshold: a DEFAULTED threshold is an ASSUMPTION (exact tie), a
  // supplied one is a caller FACT. Never silently assume without labelling it.
  const thresholdSupplied = input.materialityThreshold != null;
  const materialityThreshold = thresholdSupplied ? (input.materialityThreshold as number) : 0;
  if (thresholdSupplied) {
    sources.push({ label: "Materiality threshold", kind: "fact", value: materialityThreshold });
  } else {
    sources.push({ label: "Materiality threshold", kind: "assumption", value: 0, ref: "exact tie required — none supplied" });
    missingContext.push("Materiality threshold not supplied — exact tie (0) assumed; supply a threshold to tie within materiality.");
  }

  let tiedCount = 0;
  let varianceCount = 0;
  let unsupportedCount = 0;
  let supportedLines = 0;
  const unsupportedLabels: string[] = [];

  const tieOuts: TieOut[] = statementLines.map((line) => {
    // The statement value is a FACT — as reported.
    sources.push({ label: `${line.label} — statement value`, kind: "fact", value: line.statementValue });

    // NO supporting value → UNSUPPORTED. Variance stays null; it is NEVER assumed to
    // equal the statement value.
    if (line.supportValue == null) {
      unsupportedCount++;
      unsupportedLabels.push(line.label);
      return {
        label: line.label,
        statementValue: line.statementValue,
        supportValue: null,
        variance: null,
        status: "unsupported",
        schedule: line.schedule ?? null,
      };
    }

    // The support value is a FACT — per the schedule / GL.
    sources.push({ label: `${line.label} — support value`, kind: "fact", value: line.supportValue });
    supportedLines++;

    // Variance is a CALCULATION, never a fact.
    const variance = round2(line.statementValue - line.supportValue);
    sources.push({ label: `${line.label} — variance`, kind: "calculation", value: variance, ref: "statementValue − supportValue" });

    const status = Math.abs(variance) <= materialityThreshold ? "tied" : "variance";
    if (status === "tied") tiedCount++;
    else varianceCount++;

    return {
      label: line.label,
      statementValue: line.statementValue,
      supportValue: line.supportValue,
      variance,
      status,
      schedule: line.schedule ?? null,
    };
  });

  const totalAbsVariance = round2(
    tieOuts.reduce((s, t) => s + (t.variance != null ? Math.abs(t.variance) : 0), 0),
  );
  if (supportedLines > 0) {
    sources.push({ label: "Total absolute variance", kind: "calculation", value: totalAbsVariance, ref: "Σ|variance| over supported lines" });
  }

  // Surface unsupported lines — flagged, never silently tied.
  if (unsupportedLabels.length) {
    missingContext.push(
      `${unsupportedLabels.length} line(s) have no supporting value and could not be tied out: ${unsupportedLabels.join(", ")}.`,
    );
  }

  // Completeness is driven by the share of lines that carry supporting values.
  const completeness = Math.round((supportedLines / statementLines.length) * 100) / 100;
  const clean = varianceCount === 0 && unsupportedCount === 0;
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5 + (clean ? 0.05 : 0)));

  const recommendedAction = clean
    ? "All lines tie within materiality — audit support prepared for review. This tool does not issue an audit opinion or sign off; the external auditor / a human owns that."
    : `${unsupportedCount} unsupported and ${varianceCount} variance line(s) require supporting schedules before the auditor's review; this tool does not issue an opinion.`;

  const narrative =
    `Tied out ${statementLines.length} statement line(s): ` +
    `${tiedCount} tied, ${varianceCount} with variance, ${unsupportedCount} unsupported` +
    `${supportedLines ? `, total absolute variance $${totalAbsVariance}` : ""}. ` +
    `Prepared for review — this skill does not issue an audit opinion or sign off. Next: ${recommendedAction}`;

  const structured: AuditStatementOutput = {
    tieOuts,
    tiedCount,
    varianceCount,
    unsupportedCount,
    totalAbsVariance,
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
  properties: {
    statementLines: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "statementValue"],
        properties: {
          label: { type: "string", minLength: 1 },
          statementValue: { type: "number" },
          supportValue: { type: "number" },
          schedule: { type: "string" },
        },
      },
    },
    materialityThreshold: { type: "number", minimum: 0 },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["tieOuts", "tiedCount", "varianceCount", "unsupportedCount", "totalAbsVariance", "recommendedAction"],
  properties: {
    tieOuts: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "statementValue", "status"],
        properties: {
          label: { type: "string" },
          statementValue: { type: "number" },
          supportValue: { type: "number" },
          variance: { type: "number" },
          status: { type: "string" },
          schedule: { type: "string" },
        },
      },
    },
    tiedCount: { type: "integer", minimum: 0 },
    varianceCount: { type: "integer", minimum: 0 },
    unsupportedCount: { type: "integer", minimum: 0 },
    totalAbsVariance: { type: "number" },
    recommendedAction: { type: "string" },
    missingContext: { type: "array", items: { type: "string" } },
  },
};

export const auditStatementManifest: SkillManifest = {
  id: "audit-statement",
  name: "Audit Statement Tie-Out",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["fund_admin"],
  supportedEntityTypes: ["fund", "capital_activity", "financial_model"],
  requiredInputs: [],
  optionalInputs: ["statementLines", "materialityThreshold"],
  outputs: ["tieOuts", "tiedCount", "varianceCount", "unsupportedCount", "totalAbsVariance", "recommendedAction", "missingContext"],
  artifactTypes: ["analysis"],
  dataPermissions: ["fund:read", "capital_activity:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated balances — a line with no support is unsupported with a null variance",
    "a defaulted materiality threshold is labelled an assumption",
  ],
  evaluationCriteria: [
    "variance correct on golden cases",
    "line tied within materiality vs variance beyond it decided correctly",
    "missing support flagged unsupported not assumed equal",
    "empty statement lines returns empty tie-out with a note, never invents balances",
    "prepares audit support only — never issues an opinion, signs off, or posts",
  ],
  providerCapabilities: ["structured_extraction", "financial_reasoning"],
  allowedDownstreamSkills: ["nav-review", "close-period"],
  prohibitedActions: ["post_journal_entry", "close_period", "move_capital", "sign_document"],
  inputSchema,
  outputSchema,
};

export const auditStatement: SkillDefinition<AuditStatementInput, AuditStatementOutput> = {
  manifest: auditStatementManifest,
  run,
};
