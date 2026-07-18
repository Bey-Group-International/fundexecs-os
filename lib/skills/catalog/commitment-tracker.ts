// lib/skills/catalog/commitment-tracker.ts
// Native skill: track a SUPPLIED set of LP commitments/allocations against a fund
// target close. Pure, deterministic core — the tested execution path. It TRACKS
// the records the caller provides: total committed, remaining-to-target, per-investor
// allocation %, and over/under-subscription. It NEVER binds capital, issues a capital
// call, or moves money — those are prohibited Tier-3 actions reserved for a human.
// It NEVER fabricates a commitment: an empty set returns an empty roll-up plus a note,
// and a commitment with no amount is counted but flagged, never silently assumed to be
// zero. Every supplied amount/status is a `fact`; every total/percentage is a
// `calculation`. LLM enrichment of the narrative is an optional follow-on that wraps
// this core; the roll-up and every number come from here.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type CommitmentStatus = "soft_circle" | "committed" | "signed" | "funded";

export interface CommitmentInput {
  investor: string;
  amount?: number;
  status?: CommitmentStatus;
  closeDate?: string;
}

export interface CommitmentTrackerInput {
  targetClose?: number;
  hardCap?: number;
  commitments?: CommitmentInput[];
}

export interface InvestorAllocation {
  investor: string;
  amount: number | null;
  pctOfTotal: number; // 0–100 of the known committed total
  status: CommitmentStatus | null;
}

export interface CommitmentTrackerOutput {
  byInvestor: InvestorAllocation[];
  totalCommitted: number;
  bindingCommitted: number;
  totalInvestors: number;
  remainingToTarget: number | null;
  pctOfTarget: number | null;
  targetClose: number | null;
  overSubscribed: boolean;
  recommendedAction: string;
  missingContext: string[];
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const NO_COMMITMENTS_NOTE =
  "No commitments supplied — this skill tracks a provided commitment set; it does not fabricate commitments.";

const NO_TARGET_NOTE =
  "No target close supplied — remaining-to-target and % of target could not be computed.";

const BINDING_STATUSES: CommitmentStatus[] = ["signed", "funded"];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const run: SkillCore<CommitmentTrackerInput, CommitmentTrackerOutput> = (input): SkillCoreResult<CommitmentTrackerOutput> => {
  const commitments = input.commitments ?? [];
  const targetClose = input.targetClose ?? null;
  const hardCap = input.hardCap ?? null;
  const sources: SkillSource[] = [];
  const missingContext: string[] = [];

  // GUARDRAIL: an empty commitment set is NEVER filled in. Return an empty roll-up
  // and say so — this skill tracks what it is given, it does not invent commitments.
  if (commitments.length === 0) {
    missingContext.push(NO_COMMITMENTS_NOTE);
    if (targetClose == null) missingContext.push(NO_TARGET_NOTE);
    const structured: CommitmentTrackerOutput = {
      byInvestor: [],
      totalCommitted: 0,
      bindingCommitted: 0,
      totalInvestors: 0,
      remainingToTarget: targetClose != null ? Math.max(0, targetClose) : null,
      pctOfTarget: targetClose != null ? 0 : null,
      targetClose,
      overSubscribed: false,
      recommendedAction:
        "Supply a commitment set (LP allocations, soft-circles, signed subs) — this skill tracks provided commitments against a target; it does not fabricate them. Any capital call or funding is a human Tier-3 action.",
      missingContext,
    };
    const narrative =
      "No commitments supplied. This skill tracks a provided commitment set against the fund target; it does not fabricate commitments, bind capital, or issue a capital call. Provide commitments to roll up.";
    return { structured, narrative, sources, confidence: 0.2, completeness: 0, missingData: [...missingContext] };
  }

  // Roll up the SUPPLIED records. A missing amount is counted (the investor is real)
  // but excluded from every sum and flagged — it is never silently assumed to be zero.
  const missingAmounts: string[] = [];
  let totalCommitted = 0;
  let bindingCommitted = 0;

  for (const c of commitments) {
    // Record provided fields as FACTS — nothing is fabricated.
    if (c.amount != null) sources.push({ label: `${c.investor} — commitment amount`, kind: "fact", value: c.amount });
    if (c.status) sources.push({ label: `${c.investor} — status`, kind: "fact", value: c.status });
    if (c.closeDate) sources.push({ label: `${c.investor} — close date`, kind: "fact", value: c.closeDate });

    if (c.amount == null) {
      if (!missingAmounts.includes(c.investor)) missingAmounts.push(c.investor);
      continue;
    }
    totalCommitted += c.amount;
    if (c.status != null && BINDING_STATUSES.includes(c.status)) bindingCommitted += c.amount;
  }

  // totalCommitted / bindingCommitted are CALCULATIONS, never facts.
  sources.push({ label: "Total committed", kind: "calculation", value: totalCommitted, ref: "sum of supplied commitment amounts" });
  sources.push({ label: "Binding committed", kind: "calculation", value: bindingCommitted, ref: "sum of signed/funded amounts" });

  // Per-investor allocation. pctOfTotal is a CALCULATION over the KNOWN total; a
  // commitment with no amount contributes 0% and carries a null amount (not zero).
  const byInvestor: InvestorAllocation[] = commitments
    .map((c) => {
      const pctOfTotal = c.amount != null && totalCommitted > 0 ? Math.round((c.amount / totalCommitted) * 100) : 0;
      if (c.amount != null)
        sources.push({ label: `${c.investor} — % of total`, kind: "calculation", value: pctOfTotal, ref: "amount / total committed" });
      return {
        investor: c.investor,
        amount: c.amount ?? null,
        pctOfTotal,
        status: c.status ?? null,
      };
    })
    // Sorted by amount desc; commitments with no amount sort last.
    .sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));

  // Target close: remaining-to-target and % of target when the target is supplied,
  // else null + flagged (never assumed).
  let remainingToTarget: number | null = null;
  let pctOfTarget: number | null = null;
  if (targetClose != null) {
    remainingToTarget = Math.max(0, targetClose - totalCommitted);
    pctOfTarget = targetClose > 0 ? Math.round((totalCommitted / targetClose) * 100) : 0;
    sources.push({ label: "Remaining to target", kind: "calculation", value: remainingToTarget, ref: "max(0, target close − total committed)" });
    sources.push({ label: "% of target", kind: "calculation", value: pctOfTarget, ref: "total committed / target close" });
  } else {
    missingContext.push(NO_TARGET_NOTE);
  }

  // Over-subscription against the hard cap — a prominent warning, never a capital action.
  const overSubscribed = hardCap != null && totalCommitted > hardCap;
  if (overSubscribed) {
    missingContext.push(
      `OVER-SUBSCRIBED — total committed ${usd(totalCommitted)} exceeds the hard cap ${usd(hardCap as number)} by ${usd(totalCommitted - (hardCap as number))}. Scale-back is a human decision; this skill does not bind or reallocate capital.`,
    );
  }

  if (missingAmounts.length)
    missingContext.push(
      `Commitment amount missing for ${missingAmounts.length} investor(s) (${missingAmounts.join(", ")}) — counted but excluded from totals, not assumed to be zero.`,
    );

  const softCircled = commitments.filter((c) => c.status === "soft_circle").length;
  const totalInvestors = commitments.length;

  // recommendedAction — always advisory; capital call / funding is a human Tier-3 action.
  let recommendedAction: string;
  if (overSubscribed) {
    recommendedAction =
      `Over the hard cap of ${usd(hardCap as number)} (committed ${usd(totalCommitted)}) — scale back allocations before close. Binding, calling, or moving capital is a human Tier-3 action, never taken here.`;
  } else if (targetClose != null) {
    recommendedAction =
      `Committed ${usd(totalCommitted)} of ${usd(targetClose)} target (${pctOfTarget}%); ${remainingToTarget === 0 ? "target reached" : `${usd(remainingToTarget as number)} remaining`}` +
      `${softCircled ? `, ${softCircled} investor(s) still soft-circled` : ""}. Capital call / funding is a human Tier-3 action, never taken here.`;
  } else {
    recommendedAction =
      `Tracking ${usd(totalCommitted)} committed across ${totalInvestors} investor(s)${softCircled ? ` (${softCircled} soft-circled)` : ""}; supply a target close to measure remaining-to-target. Capital call / funding is a human Tier-3 action, never taken here.`;
  }

  const withAmount = totalInvestors - missingAmounts.length;
  const completeness = totalInvestors ? Math.round((withAmount / totalInvestors) * 100) / 100 : 0;
  const confidence = Math.max(0.2, Math.min(0.95, 0.4 + completeness * 0.5 + (targetClose != null ? 0.05 : 0)));

  const narrative =
    `Rolled up ${totalInvestors} supplied commitment(s): ${usd(totalCommitted)} committed` +
    `${bindingCommitted ? ` (${usd(bindingCommitted)} signed/funded)` : ""}` +
    `${targetClose != null ? ` against a ${usd(targetClose)} target (${pctOfTarget}%)` : ""}` +
    `${overSubscribed ? " — OVER the hard cap" : ""}. ` +
    `${missingAmounts.length ? `${missingAmounts.length} amount(s) missing and excluded from totals. ` : ""}` +
    `This skill tracks supplied records only; it never binds, calls, or moves capital. Next: ${recommendedAction}`;

  const structured: CommitmentTrackerOutput = {
    byInvestor,
    totalCommitted,
    bindingCommitted,
    totalInvestors,
    remainingToTarget,
    pctOfTarget,
    targetClose,
    overSubscribed,
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
    targetClose: { type: "number", minimum: 0 },
    hardCap: { type: "number", minimum: 0 },
    commitments: {
      type: "array",
      items: {
        type: "object",
        required: ["investor"],
        properties: {
          investor: { type: "string", minLength: 1 },
          amount: { type: "number", minimum: 0 },
          status: { type: "string", enum: ["soft_circle", "committed", "signed", "funded"] },
          closeDate: { type: "string" },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["byInvestor", "totalCommitted", "bindingCommitted", "totalInvestors", "overSubscribed", "recommendedAction"],
  properties: {
    byInvestor: {
      type: "array",
      items: {
        type: "object",
        required: ["investor", "pctOfTotal"],
        properties: {
          investor: { type: "string" },
          amount: { type: "number", minimum: 0 },
          pctOfTotal: { type: "number", minimum: 0, maximum: 100 },
          status: { type: "string", enum: ["soft_circle", "committed", "signed", "funded"] },
        },
      },
    },
    totalCommitted: { type: "number", minimum: 0 },
    bindingCommitted: { type: "number", minimum: 0 },
    totalInvestors: { type: "number", minimum: 0 },
    remainingToTarget: { type: "number", minimum: 0 },
    pctOfTarget: { type: "number", minimum: 0 },
    targetClose: { type: "number", minimum: 0 },
    overSubscribed: { type: "boolean" },
    recommendedAction: { type: "string" },
    missingContext: { type: "array", items: { type: "string" } },
  },
};

export const commitmentTrackerManifest: SkillManifest = {
  id: "commitment-tracker",
  name: "Commitment Tracker",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["capital_formation"],
  supportedEntityTypes: ["fund", "investor", "commitment"],
  requiredInputs: [],
  optionalInputs: ["targetClose", "hardCap", "commitments"],
  outputs: [
    "byInvestor",
    "totalCommitted",
    "bindingCommitted",
    "totalInvestors",
    "remainingToTarget",
    "pctOfTarget",
    "targetClose",
    "overSubscribed",
    "recommendedAction",
    "missingContext",
  ],
  artifactTypes: ["analysis"],
  dataPermissions: ["fund:read", "investor:read", "commitment:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated commitments",
    "never binds, calls, or moves capital",
  ],
  evaluationCriteria: [
    "tracks only supplied commitments",
    "empty commitment set returns an empty roll-up with a note, never invents commitments",
    "a missing amount is counted but flagged and excluded from totals, never assumed zero",
    "supplied amount/status labelled fact, totals/percentages labelled calculation",
    "over-hard-cap is detected and flagged; the skill never binds or calls capital",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["capital_call", "move_capital", "sign_document", "execute_subdoc"],
  inputSchema,
  outputSchema,
};

export const commitmentTracker: SkillDefinition<CommitmentTrackerInput, CommitmentTrackerOutput> = {
  manifest: commitmentTrackerManifest,
  run,
};
