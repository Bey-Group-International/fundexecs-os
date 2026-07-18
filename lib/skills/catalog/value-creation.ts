// lib/skills/catalog/value-creation.ts
// Native skill: build a VALUE-CREATION PLAN for a portfolio company — an EBITDA
// bridge from the current run-rate to a target, ranked initiatives, and a 100-day
// plan. Pure, deterministic core — the tested execution path. Like every FundExecs
// skill it NEVER invents financial values: a provided figure is a FACT
// (kind:"fact"), every computed number is a CALCULATION (kind:"calculation"), the
// derived 100-day plan is GENERATED (kind:"generated"), and a missing input is
// FLAGGED (missingFields) — an initiative with no stated impact is treated as 0
// and noted, never fabricated. LLM enrichment of the narrative is an optional
// follow-on that wraps this core; the bridge, the ranking, and the gap come from
// here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface ValueCreationInitiative {
  name: string;
  /** EBITDA uplift the initiative is expected to deliver, $M. Missing → treated as 0 and flagged. */
  ebitdaImpact?: number;
  /** Workstream / owner, e.g. "Commercial", "Operations". */
  workstream?: string;
  /** Expected time to realise, in months. ≤3 lands the initiative in the 100-day plan. */
  timelineMonths?: number;
}

export interface ValueCreationInput {
  companyName: string;
  /** Current run-rate EBITDA, $M. */
  currentEbitda?: number;
  /** Target EBITDA at exit / plan horizon, $M. */
  targetEbitda?: number;
  initiatives?: ValueCreationInitiative[];
}

export interface EbitdaBridgeStep {
  step: string;
  amount: number | null;
}

export interface RankedInitiative {
  name: string;
  ebitdaImpact: number | null;
  workstream: string | null;
  timelineMonths: number | null;
}

export interface ValueCreationOutput {
  bridgedEbitda: number | null;
  gapToTarget: number | null;
  ebitdaBridge: EbitdaBridgeStep[];
  rankedInitiatives: RankedInitiative[];
  hundredDayPlan: string[];
  missingFields: string[];
  keyRisks: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

const NO_HUNDRED_DAY = "No 100-day (<=3mo) initiatives identified";

const run: SkillCore<ValueCreationInput, ValueCreationOutput> = (input): SkillCoreResult<ValueCreationOutput> => {
  const sources: SkillSource[] = [];
  const missingFields: string[] = [];
  const keyRisks: string[] = [];

  const { companyName, currentEbitda, targetEbitda } = input;
  const initiatives = input.initiatives ?? [];

  // --- Provided figures are FACTS. Nothing here is fabricated. ---
  if (currentEbitda != null) sources.push({ label: "Current EBITDA", kind: "fact", value: currentEbitda });
  if (targetEbitda != null) sources.push({ label: "Target EBITDA", kind: "fact", value: targetEbitda });

  // --- Missing headline inputs are FLAGGED, never invented. ---
  if (currentEbitda == null) missingFields.push("Current EBITDA");
  if (targetEbitda == null) missingFields.push("Target EBITDA");

  // --- Sum of initiative EBITDA impact — a missing impact is treated as 0 and NOTED. ---
  let sumImpact = 0;
  for (const it of initiatives) {
    if (it.ebitdaImpact != null) {
      sumImpact += it.ebitdaImpact;
      sources.push({ label: `Initiative "${it.name}" EBITDA impact`, kind: "fact", value: it.ebitdaImpact });
    } else {
      missingFields.push(`Initiative "${it.name}" EBITDA impact (treated as 0)`);
    }
  }
  sumImpact = round2(sumImpact);
  sources.push({ label: "Total initiative EBITDA impact", kind: "calculation", value: sumImpact, ref: "Σ initiative.ebitdaImpact (missing = 0)" });

  // --- Bridged EBITDA — a CALCULATION, only when current EBITDA is known. ---
  const bridgedEbitda = currentEbitda != null ? round2(currentEbitda + sumImpact) : null;
  if (bridgedEbitda != null) {
    sources.push({ label: "Bridged EBITDA", kind: "calculation", value: bridgedEbitda, ref: "currentEbitda + Σ ebitdaImpact" });
  }

  // --- Gap to target — a CALCULATION, only when both bridged and target exist. ---
  const gapToTarget = bridgedEbitda != null && targetEbitda != null ? round2(targetEbitda - bridgedEbitda) : null;
  if (gapToTarget != null) {
    sources.push({ label: "Gap to target", kind: "calculation", value: gapToTarget, ref: "targetEbitda − bridgedEbitda" });
  }

  // --- EBITDA bridge — ordered: Current → each initiative → Bridged. ---
  const ebitdaBridge: EbitdaBridgeStep[] = [
    { step: "Current EBITDA", amount: currentEbitda ?? null },
    ...initiatives.map((it) => ({ step: it.name, amount: it.ebitdaImpact ?? null })),
    { step: "Bridged EBITDA", amount: bridgedEbitda },
  ];

  // --- Ranked initiatives — by EBITDA impact desc; a missing impact sorts last. ---
  const rankedInitiatives: RankedInitiative[] = initiatives
    .map((it) => ({
      name: it.name,
      ebitdaImpact: it.ebitdaImpact ?? null,
      workstream: it.workstream ?? null,
      timelineMonths: it.timelineMonths ?? null,
    }))
    .sort((a, b) => {
      if (a.ebitdaImpact == null && b.ebitdaImpact == null) return 0;
      if (a.ebitdaImpact == null) return 1;
      if (b.ebitdaImpact == null) return -1;
      return b.ebitdaImpact - a.ebitdaImpact;
    });

  // --- 100-day plan — GENERATED from initiatives realisable in ≤3 months. ---
  const hundredDayPlan = initiatives.filter((it) => it.timelineMonths != null && it.timelineMonths <= 3).map((it) => it.name);
  const anyTimelines = initiatives.some((it) => it.timelineMonths != null);
  if (hundredDayPlan.length > 0) {
    sources.push({ label: "100-day plan", kind: "generated", value: hundredDayPlan.join("; ") });
  } else if (!anyTimelines) {
    keyRisks.push(NO_HUNDRED_DAY);
  }

  // --- Key risks (deterministic). ---
  if (gapToTarget != null && gapToTarget > 0) {
    keyRisks.push(`Initiatives do not close the EBITDA gap (${gapToTarget} remaining)`);
  }

  // --- Completeness / confidence / recommendation. ---
  const denom = 2 + initiatives.length; // currentEbitda + targetEbitda + each initiative's impact
  const providedImpacts = initiatives.filter((it) => it.ebitdaImpact != null).length;
  const present = (currentEbitda != null ? 1 : 0) + (targetEbitda != null ? 1 : 0) + providedImpacts;
  const completeness = denom > 0 ? Math.round((present / denom) * 100) / 100 : 0;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5));

  const recommendedAction =
    currentEbitda == null
      ? "Provide current EBITDA to build the value-creation bridge."
      : gapToTarget != null && gapToTarget > 0
        ? `Bridge reaches ${bridgedEbitda} vs a ${targetEbitda} target — identify further initiatives to close the ${gapToTarget} gap, then sequence the 100-day plan.`
        : gapToTarget != null
          ? `Initiatives bridge to ${bridgedEbitda}, meeting the ${targetEbitda} target — execute the 100-day plan and track EBITDA realisation.`
          : `Bridge reaches ${bridgedEbitda} — set a target EBITDA to measure the gap, then execute the 100-day plan.`;

  const structured: ValueCreationOutput = {
    bridgedEbitda,
    gapToTarget,
    ebitdaBridge,
    rankedInitiatives,
    hundredDayPlan,
    missingFields,
    keyRisks,
    recommendedAction,
  };

  const narrative =
    currentEbitda == null
      ? `Value-creation plan for ${companyName} not computable — current EBITDA missing. Next: ${recommendedAction}`
      : `Value-creation plan for ${companyName}: ${initiatives.length} initiative(s) bridge EBITDA from ${currentEbitda} to ${bridgedEbitda}` +
        `${targetEbitda != null ? ` against a ${targetEbitda} target (gap ${gapToTarget})` : ""}. ` +
        `${hundredDayPlan.length ? `100-day plan: ${hundredDayPlan.join(", ")}. ` : ""}` +
        `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["companyName"],
  properties: {
    companyName: { type: "string", minLength: 1 },
    currentEbitda: { type: "number" },
    targetEbitda: { type: "number" },
    initiatives: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1 },
          ebitdaImpact: { type: "number" },
          workstream: { type: "string" },
          timelineMonths: { type: "number", minimum: 0 },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["ebitdaBridge", "rankedInitiatives", "hundredDayPlan", "missingFields", "keyRisks", "recommendedAction"],
  properties: {
    bridgedEbitda: { type: "number" },
    gapToTarget: { type: "number" },
    ebitdaBridge: {
      type: "array",
      items: {
        type: "object",
        required: ["step"],
        properties: {
          step: { type: "string" },
          amount: { type: "number" },
        },
      },
    },
    rankedInitiatives: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          ebitdaImpact: { type: "number" },
          workstream: { type: "string" },
          timelineMonths: { type: "number" },
        },
      },
    },
    hundredDayPlan: { type: "array", items: { type: "string" } },
    missingFields: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const valueCreationManifest: SkillManifest = {
  id: "value-creation",
  name: "Value-Creation Plan",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops"],
  supportedEntityTypes: ["company", "portfolio_company", "value_creation_plan"],
  requiredInputs: ["companyName"],
  optionalInputs: ["currentEbitda", "targetEbitda", "initiatives"],
  outputs: ["bridgedEbitda", "gapToTarget", "ebitdaBridge", "rankedInitiatives", "hundredDayPlan", "missingFields", "keyRisks", "recommendedAction"],
  artifactTypes: ["analysis", "memo"],
  dataPermissions: ["company:read", "value_creation_plan:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated financial values — a missing initiative impact is treated as 0 and flagged",
    "calculations and generated content labelled, not presented as facts",
  ],
  evaluationCriteria: [
    "correct EBITDA bridge math on golden cases",
    "missing data flagged not invented",
    "initiatives ranked by EBITDA impact (missing impact last)",
    "100-day plan derived from ≤3-month timelines",
    "gap-to-target risk surfaced when the bridge falls short",
  ],
  providerCapabilities: ["financial_reasoning", "structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["distribute_report", "move_capital", "sign_document"],
  inputSchema,
  outputSchema,
};

export const valueCreation: SkillDefinition<ValueCreationInput, ValueCreationOutput> = {
  manifest: valueCreationManifest,
  run,
};
