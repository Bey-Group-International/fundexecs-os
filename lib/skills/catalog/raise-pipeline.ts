// lib/skills/catalog/raise-pipeline.ts
// Native skill: aggregate a SUPPLIED set of prospective LPs into a fundraising
// pipeline roll-up. Pure, deterministic core — the tested execution path. Like
// every FundExecs skill it NEVER invents prospects or commitments: it rolls up
// only the prospects the caller provides. An empty prospect set returns an empty
// roll-up plus a note; a raise target with no prospects is FLAGGED, not filled.
// Every supplied figure (expectedTicket, probability) is a `fact`; a stage-default
// probability applied because the caller omitted one is an `assumption`; every
// derived number (weightedExpected, committedAmount, coveragePct, gapToTarget) is
// a `calculation`. LLM enrichment of the narrative is an optional follow-on that
// wraps this core; the roll-up and every number come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type RaiseStage = "identified" | "contacted" | "meeting" | "diligence" | "committed" | "passed";

export interface ProspectInput {
  name: string;
  stage: RaiseStage;
  expectedTicket?: number;
  probability?: number; // 0–1
}

export interface RaisePipelineInput {
  raiseTarget?: number;
  prospects?: ProspectInput[];
}

export interface StageRollup {
  stage: RaiseStage;
  count: number;
  expectedAmount: number;
}

export interface RaisePipelineOutput {
  byStage: StageRollup[];
  totalProspects: number;
  weightedExpected: number;
  committedAmount: number;
  coveragePct: number | null;
  gapToTarget: number | null;
  raiseTarget: number | null;
  recommendedAction: string;
  missingContext: string[];
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

// Canonical stage order — the roll-up always presents stages in this sequence.
const STAGE_ORDER: RaiseStage[] = ["identified", "contacted", "meeting", "diligence", "committed", "passed"];

// Default probabilities applied ONLY when a prospect omits `probability`. When
// used, the value is labelled an `assumption` (never a fact).
const DEFAULT_PROBABILITY: Record<RaiseStage, number> = {
  identified: 0.05,
  contacted: 0.15,
  meeting: 0.3,
  diligence: 0.55,
  committed: 1.0,
  passed: 0,
};

const NO_PROSPECTS_NOTE =
  "No prospects supplied — this skill aggregates a provided prospect set; it does not fabricate prospects.";

const round2 = (n: number) => Math.round(n * 100) / 100;

const run: SkillCore<RaisePipelineInput, RaisePipelineOutput> = (input): SkillCoreResult<RaisePipelineOutput> => {
  const prospects = input.prospects ?? [];
  const raiseTarget = input.raiseTarget ?? null;
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // GUARDRAIL: an empty prospect set is NEVER filled in. Return an empty roll-up
  // and say so — this skill aggregates what it is given, it does not invent
  // prospects. A supplied target with no prospects is flagged, not filled.
  if (prospects.length === 0) {
    missingContext.push(NO_PROSPECTS_NOTE);
    if (raiseTarget != null) {
      missingContext.push(
        `Raise target of ${raiseTarget} supplied but no prospects — coverage cannot be filled; supply a prospect set.`,
      );
    } else {
      missingContext.push("No raise target supplied — coverage vs target could not be assessed.");
    }
    const structured: RaisePipelineOutput = {
      byStage: [],
      totalProspects: 0,
      weightedExpected: 0,
      committedAmount: 0,
      coveragePct: raiseTarget != null && raiseTarget > 0 ? 0 : null,
      gapToTarget: raiseTarget != null ? round2(raiseTarget) : null,
      raiseTarget,
      recommendedAction:
        "Supply a prospect set (each at a raise stage with an expected ticket) — this skill aggregates provided prospects, it does not generate them.",
      missingContext,
    };
    const narrative =
      "No prospects supplied. This skill aggregates a provided prospect set into a fundraising pipeline roll-up; it does not fabricate prospects or commitments. Provide prospects to roll up.";
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: [...missingContext] };
  }

  // --- Per-prospect: supplied figures are FACTS; a stage-default probability is
  // an ASSUMPTION. Nothing here is fabricated. ---
  let ticketsSupplied = 0;
  let probsSupplied = 0;
  let defaultsApplied = 0;
  const missingTickets: string[] = [];

  // Resolved probability per prospect (supplied fact or stage-default assumption).
  const resolvedProb = new Map<ProspectInput, number>();

  for (const p of prospects) {
    if (p.expectedTicket != null) {
      sources.push({ label: `${p.name} — expected ticket`, kind: "fact", value: p.expectedTicket });
      ticketsSupplied += 1;
    } else {
      missingTickets.push(p.name);
    }

    if (p.probability != null) {
      sources.push({ label: `${p.name} — probability`, kind: "fact", value: p.probability });
      resolvedProb.set(p, p.probability);
      probsSupplied += 1;
    } else {
      const def = DEFAULT_PROBABILITY[p.stage];
      // Defaulted probability is an ASSUMPTION, never a fact.
      sources.push({
        label: `${p.name} — probability (stage default)`,
        kind: "assumption",
        value: def,
        ref: `default for stage "${p.stage}"`,
      });
      resolvedProb.set(p, def);
      defaultsApplied += 1;
    }
  }

  // --- byStage roll-up: count + supplied expected $ per stage present. ---
  const byStage: StageRollup[] = STAGE_ORDER.filter((stage) => prospects.some((p) => p.stage === stage)).map((stage) => {
    const inStage = prospects.filter((p) => p.stage === stage);
    const expectedAmount = round2(inStage.reduce((s, p) => s + (p.expectedTicket ?? 0), 0));
    return { stage, count: inStage.length, expectedAmount };
  });

  // --- weightedExpected: Σ expectedTicket × probability across NON-PASSED
  // prospects — a CALCULATION, not a commitment. ---
  const weightedExpected = round2(
    prospects
      .filter((p) => p.stage !== "passed")
      .reduce((s, p) => s + (p.expectedTicket ?? 0) * (resolvedProb.get(p) ?? 0), 0),
  );
  sources.push({
    label: "Weighted expected commitments",
    kind: "calculation",
    value: weightedExpected,
    ref: "Σ expectedTicket × probability across non-passed prospects",
  });

  // --- committedAmount: Σ expectedTicket where stage = committed — a CALCULATION
  // (a sum of supplied figures, still NOT binding). ---
  const committedAmount = round2(
    prospects.filter((p) => p.stage === "committed").reduce((s, p) => s + (p.expectedTicket ?? 0), 0),
  );
  sources.push({
    label: "Committed amount (indicative)",
    kind: "calculation",
    value: committedAmount,
    ref: "Σ expectedTicket where stage = committed",
  });

  // --- Coverage vs target — CALCULATIONS only when a target is supplied. ---
  let coveragePct: number | null = null;
  let gapToTarget: number | null = null;
  if (raiseTarget != null) {
    coveragePct = raiseTarget > 0 ? Math.round((weightedExpected / raiseTarget) * 100) : null;
    gapToTarget = round2(Math.max(0, raiseTarget - weightedExpected));
    if (coveragePct != null) {
      sources.push({ label: "Coverage % of target", kind: "calculation", value: `${coveragePct}%`, ref: "weightedExpected / raiseTarget × 100" });
    }
    sources.push({ label: "Gap to target", kind: "calculation", value: gapToTarget, ref: "max(0, raiseTarget − weightedExpected)" });
  } else {
    missingContext.push("No raise target supplied — coverage vs target could not be assessed.");
  }

  // --- Missing-context notes — surfaced, never silently assumed. ---
  if (missingTickets.length) {
    missingContext.push(
      `Expected ticket missing for ${missingTickets.length} prospect(s) — excluded from expected $ and weighted roll-up.`,
    );
  }
  if (defaultsApplied) {
    missingContext.push(
      `Stage-default probability applied to ${defaultsApplied} prospect(s) — supply a probability to override the assumption.`,
    );
  }

  // --- Completeness / confidence / recommendation. ---
  const n = prospects.length;
  const completeness = round2(
    (ticketsSupplied / n) * 0.6 + (probsSupplied / n) * 0.2 + (raiseTarget != null ? 0.2 : 0),
  );
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.5));

  const diligenceCount = prospects.filter((p) => p.stage === "diligence").length;
  const recommendedAction =
    raiseTarget == null
      ? "No raise target supplied — set a target to assess pipeline coverage."
      : `Weighted pipeline covers ${coveragePct ?? 0}% of the ${raiseTarget} target; ${
          diligenceCount > 0
            ? `advance ${diligenceCount} diligence-stage prospect(s) to close the ${gapToTarget} gap.`
            : `advance mid-stage prospects to close the ${gapToTarget} gap.`
        }`;

  const structured: RaisePipelineOutput = {
    byStage,
    totalProspects: n,
    weightedExpected,
    committedAmount,
    coveragePct,
    gapToTarget,
    raiseTarget,
    recommendedAction,
    missingContext,
  };

  const narrative =
    `Rolled up ${n} supplied prospect(s) across ${byStage.length} stage(s): ` +
    `weighted expected ${weightedExpected}, committed ${committedAmount}. ` +
    `${raiseTarget != null ? `Coverage ${coveragePct ?? 0}% of ${raiseTarget} target, gap ${gapToTarget}. ` : "No raise target supplied. "}` +
    `${missingContext.length ? `Notes: ${missingContext.join(" ")} ` : ""}` +
    `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingContext] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    raiseTarget: { type: "number", minimum: 0 },
    prospects: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "stage"],
        properties: {
          name: { type: "string", minLength: 1 },
          stage: { type: "string", enum: ["identified", "contacted", "meeting", "diligence", "committed", "passed"] },
          expectedTicket: { type: "number", minimum: 0 },
          probability: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["byStage", "totalProspects", "weightedExpected", "committedAmount", "recommendedAction"],
  properties: {
    byStage: {
      type: "array",
      items: {
        type: "object",
        required: ["stage", "count", "expectedAmount"],
        properties: {
          stage: { type: "string", enum: ["identified", "contacted", "meeting", "diligence", "committed", "passed"] },
          count: { type: "number", minimum: 0 },
          expectedAmount: { type: "number", minimum: 0 },
        },
      },
    },
    totalProspects: { type: "number", minimum: 0 },
    weightedExpected: { type: "number", minimum: 0 },
    committedAmount: { type: "number", minimum: 0 },
    coveragePct: { type: "number", minimum: 0 },
    gapToTarget: { type: "number", minimum: 0 },
    raiseTarget: { type: "number", minimum: 0 },
    recommendedAction: { type: "string" },
    missingContext: { type: "array", items: { type: "string" } },
  },
};

export const raisePipelineManifest: SkillManifest = {
  id: "raise-pipeline",
  name: "Raise Pipeline",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["capital_formation"],
  supportedEntityTypes: ["lp", "fund", "raise"],
  requiredInputs: [],
  optionalInputs: ["raiseTarget", "prospects"],
  outputs: [
    "byStage",
    "totalProspects",
    "weightedExpected",
    "committedAmount",
    "coveragePct",
    "gapToTarget",
    "raiseTarget",
    "recommendedAction",
    "missingContext",
  ],
  artifactTypes: ["analysis"],
  dataPermissions: ["lp:read", "fund:read", "raise:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated prospects or commitments",
    "weighting is a labelled calculation, not a commitment",
  ],
  evaluationCriteria: [
    "rolls up only supplied prospects",
    "empty prospect set returns empty roll-up with a note, never invents prospects",
    "weightedExpected labelled calculation, committedAmount labelled calculation",
    "defaulted probability labelled assumption, supplied ticket/probability labelled fact",
    "no target yields null coverage and is flagged, never filled",
  ],
  providerCapabilities: ["structured_extraction", "financial_reasoning"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["send_outreach", "send_intro_request", "sign_document", "capital_call", "move_capital"],
  inputSchema,
  outputSchema,
};

export const raisePipeline: SkillDefinition<RaisePipelineInput, RaisePipelineOutput> = {
  manifest: raisePipelineManifest,
  run,
};
