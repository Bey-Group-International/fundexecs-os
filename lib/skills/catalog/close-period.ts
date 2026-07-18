// lib/skills/catalog/close-period.ts
// Native skill: PREPARE a period-close readiness CHECKLIST for a fund. Pure,
// deterministic core — it assesses a fixed canonical close checklist against the
// tasks the operator has marked done and reports readiness. It PREPARES only.
//
// The core guardrail: this skill NEVER closes, reopens, or posts. Actually
// closing / locking a period is a Tier-3, books-locking action that a delegated
// executive can never take — it always requires explicit human authorization.
// The canonical checklist items are a standard template, so they are labelled
// `generated` (a starting checklist to confirm), not facts about the period. A
// missing input (e.g. periodEnd) is FLAGGED, never invented.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface ClosePeriodInput {
  fundName: string;
  periodEnd?: string;
  /** Canonical task keys the operator has marked done. */
  tasksComplete?: string[];
}

export type ClosePeriodTaskStatus = "complete" | "open";

export interface ClosePeriodChecklistItem {
  key: string;
  task: string;
  status: ClosePeriodTaskStatus;
}

export interface ClosePeriodOutput {
  checklist: ClosePeriodChecklistItem[];
  /** 0–1 fraction of canonical tasks marked complete, rounded to 2 dp. */
  readiness: number;
  completeCount: number;
  totalTasks: number;
  /** Labels of the tasks still open. */
  openTasks: string[];
  missingFields: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Canonical close checklist — a standard fund-admin close template. These are
// GENERATED template items, not facts about the period. Canonical order is the
// source of truth for output ordering.
// ---------------------------------------------------------------------------

interface CloseTaskSpec {
  key: string;
  label: string;
}

const CHECKLIST: CloseTaskSpec[] = [
  { key: "bank_recs", label: "Bank reconciliations complete" },
  { key: "accruals", label: "Accruals booked" },
  { key: "capital_activity", label: "Capital activity recorded" },
  { key: "fee_calc", label: "Management/performance fees calculated" },
  { key: "nav_tieout", label: "NAV tie-out complete" },
  { key: "lp_statements", label: "LP statements prepared" },
  { key: "subdoc_updates", label: "Subscription/transfer updates applied" },
  { key: "investor_reporting", label: "Investor reporting drafted" },
];

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const clean = (s: string | undefined): string => (s ?? "").trim();

const run: SkillCore<ClosePeriodInput, ClosePeriodOutput> = (input): SkillCoreResult<ClosePeriodOutput> => {
  const { fundName, periodEnd, tasksComplete } = input;
  const sources: SkillSource[] = [];
  const missingFields: string[] = [];

  // Guard — require fundName; a blank value is FLAGGED, never invented.
  if (clean(fundName) === "") {
    missingFields.push("Fund name not provided — cannot identify the period to assess.");
  }

  // Guard — periodEnd absent: flag it and note the checklist is not period-dated.
  if (clean(periodEnd) === "") {
    missingFields.push("Period-end date not provided — checklist is not period-dated.");
  } else {
    sources.push({ label: "Period-end", kind: "fact", value: clean(periodEnd) });
  }

  // Normalise the operator-supplied completed keys.
  const done = new Set((tasksComplete ?? []).map((k) => clean(k)).filter((k) => k !== ""));

  // Assess each canonical task. The checklist is a GENERATED template; a task the
  // operator marked done is recorded as a FACT.
  const checklist: ClosePeriodChecklistItem[] = CHECKLIST.map((t) => {
    const status: ClosePeriodTaskStatus = done.has(t.key) ? "complete" : "open";
    if (status === "complete") sources.push({ label: t.label, kind: "fact", value: "complete", ref: `task:${t.key}` });
    return { key: t.key, task: t.label, status };
  });
  sources.push({ label: "Canonical close checklist (template)", kind: "generated", value: CHECKLIST.length, ref: "catalog:close-period" });

  const totalTasks = checklist.length;
  const completeCount = checklist.filter((c) => c.status === "complete").length;
  const openTasks = checklist.filter((c) => c.status === "open").map((c) => c.task);
  const readiness = Math.round((completeCount / totalTasks) * 100) / 100;
  sources.push({ label: "Close readiness", kind: "calculation", value: readiness, ref: "completeCount ÷ totalTasks" });

  // recommendedAction — ALWAYS stresses that closing the period is a Tier-3 action
  // requiring explicit human authorization, and is NEVER performed by this skill.
  const tier3Note =
    "Closing/locking the period is a Tier-3 action requiring explicit human authorization — it is never performed by this skill.";
  const recommendedAction =
    readiness < 1
      ? `Resolve open items before requesting close. ${tier3Note}`
      : `All checklist items complete — ready to request close. ${tier3Note}`;

  const structured: ClosePeriodOutput = {
    checklist,
    readiness,
    completeCount,
    totalTasks,
    openTasks,
    missingFields,
    recommendedAction,
  };

  const completeness = readiness;
  const confidence = Math.max(0.3, Math.min(0.9, 0.4 + readiness * 0.5));

  const narrative =
    `Close-readiness checklist for ${clean(fundName) || "the fund"}${clean(periodEnd) ? ` (period ending ${clean(periodEnd)})` : ""}: ` +
    `${completeCount}/${totalTasks} tasks complete (readiness ${readiness}).` +
    `${openTasks.length ? ` Open: ${openTasks.join(", ")}.` : " No open items."}` +
    `${missingFields.length ? ` Missing: ${missingFields.length} field(s).` : ""} ` +
    `This PREPARES a close-readiness checklist only; it never closes, reopens, or posts to the period. ` +
    `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["fundName"],
  properties: {
    fundName: { type: "string", minLength: 1 },
    periodEnd: { type: "string" },
    tasksComplete: { type: "array", items: { type: "string" } },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["checklist", "readiness", "completeCount", "totalTasks", "openTasks", "missingFields", "recommendedAction"],
  properties: {
    checklist: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "task", "status"],
        properties: {
          key: { type: "string" },
          task: { type: "string" },
          status: { type: "string", enum: ["complete", "open"] },
        },
      },
    },
    readiness: { type: "number", minimum: 0, maximum: 1 },
    completeCount: { type: "number", minimum: 0 },
    totalTasks: { type: "number", minimum: 0 },
    openTasks: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const closePeriodManifest: SkillManifest = {
  id: "close-period",
  name: "Period-Close Checklist",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["fund_admin"],
  supportedEntityTypes: ["fund", "period", "close_checklist"],
  requiredInputs: ["fundName"],
  optionalInputs: ["periodEnd", "tasksComplete"],
  outputs: ["checklist", "readiness", "completeCount", "totalTasks", "openTasks", "missingFields", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["fund:read", "period:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "the skill only PREPARES a checklist — it never closes, reopens, or posts to the period",
    "canonical checklist items labelled generated, not facts; a missing input is flagged, not invented",
  ],
  evaluationCriteria: [
    "all eight canonical tasks present in canonical order",
    "status is complete only for tasks the operator marked done",
    "readiness = round(completeCount / totalTasks, 2)",
    "recommendedAction always states closing the period is a Tier-3 action requiring human authorization",
    "missing periodEnd flagged not invented",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["close_period", "post_to_closed_period", "reopen_period", "post_journal_entry"],
  inputSchema,
  outputSchema,
};

export const closePeriod: SkillDefinition<ClosePeriodInput, ClosePeriodOutput> = {
  manifest: closePeriodManifest,
  run,
};
