// lib/skills/catalog/model-audit.ts
// Native skill: audit a caller-SUPPLIED financial model for internal consistency
// and red flags. Pure, deterministic core — the tested execution path. Like every
// FundExecs skill it NEVER invents information: it runs a rules grid over the line
// items, checks, and ratios it is GIVEN and FLAGS anomalies with a severity. It
// reviews SUPPLIED figures; it never re-computes a corrected model, and it never
// invents a "right" number — a breach is flagged for the analyst to fix. Every
// supplied value is a `fact`; every pass/fail verdict is a `calculation` (the audit
// verdict, not a new model value). An empty model yields empty findings plus an
// explicit note — not a fabricated one. LLM enrichment of the narrative is an
// optional follow-on that wraps this core; the findings and every verdict come
// from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface LineItemInput {
  label: string;
  value: number;
  min?: number;
  max?: number;
  /** Free-text hint, e.g. "revenue" | "cost" | "asset" — drives the sign rule. */
  kind?: string;
}

export interface CheckInput {
  label: string;
  lhs: number;
  rhs: number;
  /** Allowed absolute divergence between lhs and rhs. Defaults to 0 (exact). */
  tolerance?: number;
}

export type RatioKind = "margin" | "growth" | "multiple" | "rate";

export interface RatioInput {
  label: string;
  value: number;
  kind?: RatioKind;
}

export interface ModelAuditInput {
  lineItems?: LineItemInput[];
  checks?: CheckInput[];
  ratios?: RatioInput[];
}

export type FindingArea = "lineItem" | "check" | "ratio";
export type FindingSeverity = "info" | "warning" | "error";

export interface Finding {
  area: FindingArea;
  label: string;
  severity: FindingSeverity;
  message: string;
}

export interface ModelAuditOutput {
  findings: Finding[];
  checkedCount: number;
  passedCount: number;
  failedCount: number;
  errorCount: number;
  warningCount: number;
  summary: string;
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const NO_MODEL_NOTE =
  "No model supplied — this skill audits a provided model; it does not fabricate figures.";

// Growth beyond ±300% is implausible-but-possible → a warning, not an error.
const GROWTH_SANITY_BOUND = 3;

// Line-item kinds that should never be negative — a negative one is a red flag.
const NON_NEGATIVE_KINDS = new Set([
  "revenue",
  "sales",
  "cost",
  "costs",
  "expense",
  "expenses",
  "asset",
  "assets",
  "cash",
  "price",
  "quantity",
  "volume",
  "shares",
  "units",
]);

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

const run: SkillCore<ModelAuditInput, ModelAuditOutput> = (input): SkillCoreResult<ModelAuditOutput> => {
  const lineItems = input.lineItems ?? [];
  const checks = input.checks ?? [];
  const ratios = input.ratios ?? [];
  const sources: SkillSource[] = [];
  const findings: Finding[] = [];

  // GUARDRAIL: an empty model is NEVER filled in. Return empty findings and say so —
  // this skill audits what it is given; it does not fabricate figures.
  if (lineItems.length === 0 && checks.length === 0 && ratios.length === 0) {
    const structured: ModelAuditOutput = {
      findings: [],
      checkedCount: 0,
      passedCount: 0,
      failedCount: 0,
      errorCount: 0,
      warningCount: 0,
      summary: NO_MODEL_NOTE,
      recommendedAction:
        "Supply a model (line items, cross-checks, and/or ratios) to audit — this skill reviews provided figures, it does not generate them.",
    };
    const narrative =
      "No model supplied. This skill audits a provided model for internal consistency and red flags; it does not fabricate figures. Provide line items, checks, or ratios to audit.";
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: [NO_MODEL_NOTE] };
  }

  let passedCount = 0;
  let failedCount = 0;

  // Record a supplied value as a FACT, then the pass/fail verdict as a CALCULATION.
  // The verdict is a string ("pass"/"fail") — NEVER a corrected numeric value.
  const record = (label: string, value: number, itemFindings: Finding[]) => {
    sources.push({ label, kind: "fact", value });
    const passed = itemFindings.length === 0;
    sources.push({ label: `${label} — audit`, kind: "calculation", value: passed ? "pass" : "fail", ref: "rules-grid verdict" });
    if (passed) passedCount += 1;
    else failedCount += 1;
    findings.push(...itemFindings);
  };

  // --- Line items: range bounds + sign rule. ---
  for (const li of lineItems) {
    const f: Finding[] = [];
    if (li.min != null && li.value < li.min) {
      f.push({ area: "lineItem", label: li.label, severity: "warning", message: `Value ${li.value} is below the supplied minimum ${li.min}.` });
    }
    if (li.max != null && li.value > li.max) {
      f.push({ area: "lineItem", label: li.label, severity: "warning", message: `Value ${li.value} is above the supplied maximum ${li.max}.` });
    }
    if (li.kind && NON_NEGATIVE_KINDS.has(li.kind.toLowerCase().trim()) && li.value < 0) {
      f.push({ area: "lineItem", label: li.label, severity: "error", message: `Negative ${li.kind} (${li.value}) — a ${li.kind} line should not be negative; verify the figure.` });
    }
    record(li.label, li.value, f);
  }

  // --- Checks: an equality/subtotal that must hold within tolerance. ---
  for (const ck of checks) {
    const tolerance = ck.tolerance ?? 0;
    const diff = Math.abs(ck.lhs - ck.rhs);
    const f: Finding[] = [];
    if (diff > tolerance) {
      f.push({
        area: "check",
        label: ck.label,
        severity: "error",
        message: `Check failed: ${ck.lhs} vs ${ck.rhs} diverge by ${diff}${tolerance ? ` beyond tolerance ${tolerance}` : ""} — the two sides should agree.`,
      });
    }
    // For a check, the "supplied value" of record is the divergence itself as a fact input pair.
    sources.push({ label: `${ck.label} — lhs`, kind: "fact", value: ck.lhs });
    sources.push({ label: `${ck.label} — rhs`, kind: "fact", value: ck.rhs });
    sources.push({ label: `${ck.label} — audit`, kind: "calculation", value: f.length === 0 ? "pass" : "fail", ref: "|lhs − rhs| ≤ tolerance" });
    if (f.length === 0) passedCount += 1;
    else failedCount += 1;
    findings.push(...f);
  }

  // --- Ratios: sanity bounds by kind. ---
  for (const rt of ratios) {
    const f: Finding[] = [];
    if (rt.kind === "margin" || rt.kind === "rate") {
      if (rt.value < 0 || rt.value > 1) {
        f.push({ area: "ratio", label: rt.label, severity: "error", message: `${rt.kind} of ${pct(rt.value)} is outside the plausible 0–100% range — verify the inputs.` });
      }
    } else if (rt.kind === "growth") {
      if (Math.abs(rt.value) > GROWTH_SANITY_BOUND) {
        f.push({ area: "ratio", label: rt.label, severity: "warning", message: `Growth of ${pct(rt.value)} exceeds the ±${GROWTH_SANITY_BOUND * 100}% sanity bound — confirm it is not a data error.` });
      }
    } else if (rt.kind === "multiple") {
      if (rt.value < 0) {
        f.push({ area: "ratio", label: rt.label, severity: "error", message: `Negative multiple (${rt.value}) is implausible — verify the figure.` });
      }
    }
    record(rt.label, rt.value, f);
  }

  const checkedCount = passedCount + failedCount;
  const errorCount = findings.filter((x) => x.severity === "error").length;
  const warningCount = findings.filter((x) => x.severity === "warning").length;

  // --- Completeness / confidence from how much of the model was supplied. ---
  const suppliedGroups = [lineItems.length, checks.length, ratios.length].filter((n) => n > 0).length;
  const completeness = Math.round((suppliedGroups / 3) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.4 + completeness * 0.5));

  // --- Recommended action (deterministic). ---
  const recommendedAction =
    errorCount > 0
      ? `${errorCount} error-level issue(s) must be resolved before the model is relied upon.`
      : warningCount > 0
        ? `${warningCount} warning-level issue(s) should be reviewed by the analyst before the model is relied upon.`
        : "No anomalies detected in the supplied model — checks passed; proceed with normal review.";

  const summary =
    `Audited ${checkedCount} item(s): ${passedCount} passed, ${failedCount} flagged` +
    `${errorCount ? ` (${errorCount} error)` : ""}${warningCount ? ` (${warningCount} warning)` : ""}.`;

  const narrative =
    `Model audit ran a rules grid over ${checkedCount} supplied item(s) — ${lineItems.length} line item(s), ${checks.length} check(s), ${ratios.length} ratio(s). ` +
    `${failedCount ? `${failedCount} flagged: ${errorCount} error, ${warningCount} warning. ` : "No anomalies found. "}` +
    `This skill reviews supplied figures and flags anomalies for the analyst; it does not re-compute a corrected model. Next: ${recommendedAction}`;

  const structured: ModelAuditOutput = {
    findings,
    checkedCount,
    passedCount,
    failedCount,
    errorCount,
    warningCount,
    summary,
    recommendedAction,
  };

  return { structured, narrative, sources, confidence, completeness, missingData: [] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    lineItems: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "value"],
        properties: {
          label: { type: "string", minLength: 1 },
          value: { type: "number" },
          min: { type: "number" },
          max: { type: "number" },
          kind: { type: "string" },
        },
      },
    },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "lhs", "rhs"],
        properties: {
          label: { type: "string", minLength: 1 },
          lhs: { type: "number" },
          rhs: { type: "number" },
          tolerance: { type: "number", minimum: 0 },
        },
      },
    },
    ratios: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "value"],
        properties: {
          label: { type: "string", minLength: 1 },
          value: { type: "number" },
          kind: { type: "string", enum: ["margin", "growth", "multiple", "rate"] },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["findings", "checkedCount", "passedCount", "failedCount", "errorCount", "warningCount", "summary", "recommendedAction"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["area", "label", "severity", "message"],
        properties: {
          area: { type: "string", enum: ["lineItem", "check", "ratio"] },
          label: { type: "string" },
          severity: { type: "string", enum: ["info", "warning", "error"] },
          message: { type: "string" },
        },
      },
    },
    checkedCount: { type: "number", minimum: 0 },
    passedCount: { type: "number", minimum: 0 },
    failedCount: { type: "number", minimum: 0 },
    errorCount: { type: "number", minimum: 0 },
    warningCount: { type: "number", minimum: 0 },
    summary: { type: "string" },
    recommendedAction: { type: "string" },
  },
};

export const modelAuditManifest: SkillManifest = {
  id: "model-audit",
  name: "Model Audit",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst"],
  supportedEntityTypes: ["model", "deal", "company"],
  requiredInputs: [],
  optionalInputs: ["lineItems", "checks", "ratios"],
  outputs: ["findings", "checkedCount", "passedCount", "failedCount", "errorCount", "warningCount", "summary", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["model:read", "deal:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "audits only supplied figures — no fabricated line items, checks, or ratios",
    "supplied values are facts; each pass/fail verdict is a calculation; no finding carries a corrected value",
  ],
  evaluationCriteria: [
    "flags a margin above 100% as an error",
    "flags a failed check (lhs ≠ rhs beyond tolerance)",
    "a clean, in-range model yields no findings and all items passed",
    "an empty model returns empty findings with a note, never fabricating figures",
    "never re-computes or emits a corrected number — it flags for the analyst to fix",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document"],
  inputSchema,
  outputSchema,
};

export const modelAudit: SkillDefinition<ModelAuditInput, ModelAuditOutput> = {
  manifest: modelAuditManifest,
  run,
};
