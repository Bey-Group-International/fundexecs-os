// lib/skills/catalog/mandate-screen.ts
// Investment Mandate Definition (PE department · Deal Sourcing 01). Turns the
// fund's mandate into a written, TESTABLE screen: every criterion with its test,
// threshold, type (hard / preference / kill) and source, plus the open questions
// that stop it being signed. Every other sourcing skill tests against this.
// Pure core — never invents a threshold: a criterion with no number is a blocker.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { mandateTestsSchema } from "@/lib/pe/mandate-schema";
import { auditMandate, METRIC_LABELS, type MandateIssue, type MandateTests } from "@/lib/pe/mandate-tests";

export interface MandateScreenInput {
  mandate: MandateTests;
  /** Who signs the mandate screen; defaults to "a partner". */
  gateOwner?: string;
}

export interface ScreenRow {
  id: string;
  type: "hard-limit" | "preference" | "kill-fact";
  criterion: string;
  metric: string;
  test: string;
  threshold: string;
  source: string;
}

export interface MandateScreenOutput {
  rows: ScreenRow[];
  issues: MandateIssue[];
  openQuestions: string[];
  /** True only when no blocker remains. Sign-off is still a human act. */
  readyForSignOff: boolean;
  /** "approved" once signed, otherwise screening runs default-screened. */
  basis: "approved-mandate" | "default-screened";
  gate: string;
}

function bandText(b: { min?: number; max?: number } | undefined): string {
  if (!b || (b.min === undefined && b.max === undefined)) return "MISSING";
  if (b.min !== undefined && b.max !== undefined) return `${b.min} to ${b.max}`;
  return b.min !== undefined ? `at least ${b.min}` : `at most ${b.max}`;
}

const run: SkillCore<MandateScreenInput, MandateScreenOutput> = (input): SkillCoreResult<MandateScreenOutput> => {
  const { mandate } = input;
  const sources: SkillSource[] = [];
  const rows: ScreenRow[] = [];

  for (const h of mandate.hardLimits) {
    const numeric = h.band !== undefined || (!h.allow?.length && !h.deny?.length);
    const threshold = numeric
      ? bandText(h.band)
      : [h.allow?.length ? `in ${h.allow.join(" / ")}` : "", h.deny?.length ? `not in ${h.deny.join(" / ")}` : ""].filter(Boolean).join("; ");
    rows.push({ id: h.id, type: "hard-limit", criterion: h.label, metric: METRIC_LABELS[h.metric], test: "pass / fail — a fail ends the screen", threshold, source: h.source?.trim() || "MISSING" });
    if (h.source?.trim()) sources.push({ label: `Hard limit: ${h.label}`, kind: "fact", ref: h.source.trim() });
  }
  for (const p of mandate.preferences) {
    const threshold = p.strong || p.acceptable ? `strong ${bandText(p.strong)}; acceptable ${bandText(p.acceptable)}` : `strong ${p.strongValues?.join(" / ") || "MISSING"}; acceptable ${p.acceptableValues?.join(" / ") || "—"}`;
    rows.push({ id: p.id, type: "preference", criterion: p.label, metric: METRIC_LABELS[p.metric], test: `scored, weight ${p.weight}`, threshold, source: "fund preference" });
  }
  for (const k of mandate.killFacts) {
    const threshold = k.metric ? [k.above !== undefined ? `above ${k.above}` : "", k.below !== undefined ? `below ${k.below}` : ""].filter(Boolean).join(" or ") || "MISSING" : "asserted by the deal team";
    rows.push({ id: k.id, type: "kill-fact", criterion: k.label, metric: k.metric ? METRIC_LABELS[k.metric] : "asserted fact", test: "ends the deal regardless of score", threshold, source: "fund policy" });
  }

  const issues = auditMandate(mandate);
  const blockers = issues.filter((i) => i.severity === "blocker");
  const openQuestions = issues.map((i) => i.message);
  const readyForSignOff = rows.length > 0 && blockers.length === 0;

  const gateOwner = input.gateOwner?.trim() || "a partner";
  const gate = `${gateOwner} signs the mandate screen. Until then, screening runs default-screened and labels every result so.`;

  const structured: MandateScreenOutput = {
    rows,
    issues,
    openQuestions,
    readyForSignOff,
    basis: mandate.status === "approved" ? "approved-mandate" : "default-screened",
    gate,
  };

  const missingData = blockers.map((b) => b.message);
  const completeness = rows.length === 0 ? 0 : Math.round((1 - Math.min(1, blockers.length / rows.length)) * 100) / 100;
  const narrative =
    rows.length === 0
      ? "No criteria supplied — a mandate screen needs at least one hard limit and one preference."
      : `Mandate screen: ${rows.length} criteria (${mandate.hardLimits.length} hard, ${mandate.preferences.length} preference, ${mandate.killFacts.length} kill). ` +
        `${blockers.length ? `${blockers.length} blocker(s) before sign-off. ` : "No blockers. "}` +
        `${gate}`;

  return { structured, narrative, sources, confidence: rows.length ? 0.9 : 0.3, completeness, missingData };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["mandate"],
  properties: { mandate: mandateTestsSchema, gateOwner: { type: "string" } },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["rows", "issues", "openQuestions", "readyForSignOff", "basis", "gate"],
  properties: {
    rows: { type: "array", items: { type: "object", required: ["id", "type", "criterion", "threshold", "source"] } },
    issues: { type: "array", items: { type: "object", required: ["severity", "message"] } },
    openQuestions: { type: "array", items: { type: "string" } },
    readyForSignOff: { type: "boolean" },
    basis: { type: "string", enum: ["approved-mandate", "default-screened"] },
    gate: { type: "string" },
  },
};

export const mandateScreenManifest: SkillManifest = {
  id: "mandate-screen",
  name: "Investment Mandate Screen",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["deal_sourcer", "analyst", "investment_committee"],
  supportedEntityTypes: ["mandate"],
  requiredInputs: ["mandate"],
  optionalInputs: ["gateOwner"],
  outputs: ["rows", "issues", "openQuestions", "readyForSignOff", "basis", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["mandate:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no invented thresholds"],
  evaluationCriteria: ["criteria without a number are blockers", "unsourced hard limits are flagged", "contradictions are caught"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["target-screen", "first-look", "screen-deal", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const mandateScreen: SkillDefinition<MandateScreenInput, MandateScreenOutput> = { manifest: mandateScreenManifest, run };
