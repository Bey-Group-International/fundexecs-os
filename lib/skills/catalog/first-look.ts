// lib/skills/catalog/first-look.ts
// First Look Screen (PE department · Deal Sourcing 07). Reads the headline numbers
// from a teaser or CIM and returns a fast go / no-go / ask-more, so the team says
// no faster. Reported vs adjusted EBITDA are separated and every adjustment is
// listed individually, never netted. Numbers with no source reference are marked
// ungraded ("U") and may not carry a "go". Pure core, never invents a figure.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { dealFactsProperties, mandateTestsSchema } from "@/lib/pe/mandate-schema";
import { screenAgainstMandate, type DealFacts, type MandateTests } from "@/lib/pe/mandate-tests";

export interface EbitdaAdjustment {
  label: string;
  /** Signed: positive adds back to EBITDA. */
  amount: number;
  /** Page / tab reference in the source document. */
  sourceRef?: string;
}

export interface FirstLookDeal extends DealFacts {
  name: string;
  /** EBITDA as reported, before adjustments. */
  reportedEbitda?: number;
  adjustments?: EbitdaAdjustment[];
  /** Seller's stated adjusted EBITDA, to be reconciled against the listed adjustments. */
  statedAdjustedEbitda?: number;
  /** Source page reference per headline metric, e.g. { revenue: "CIM p.14" }. */
  sourceRefs?: Record<string, string>;
}

export interface FirstLookInput {
  mandate: MandateTests;
  deal: FirstLookDeal;
  gateOwner?: string;
}

export type FirstLookView = "go" | "no-go" | "ask-more";

export interface FirstLookOutput {
  view: FirstLookView;
  reason: string;
  numbers: Array<{ metric: string; value: number | string; sourceRef: string | null; grade: "sourced" | "U" }>;
  ebitdaBridge: {
    reported: number | null;
    adjustments: EbitdaAdjustment[];
    adjusted: number | null;
    adjustmentsShareOfReported: number | null;
    reconciles: boolean | null;
  };
  mandateResult: "pass" | "fail" | "needs-data";
  basis: "approved-mandate" | "default-screened";
  threeReasonsItCouldFail: string[];
  threeFactsThatWouldKillIt: string[];
  unsourcedNumbers: string[];
  gate: string;
}

const HEADLINE = ["revenue", "ebitda", "ebitdaMargin", "revenueCagr3y"] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

const run: SkillCore<FirstLookInput, FirstLookOutput> = (input): SkillCoreResult<FirstLookOutput> => {
  const { mandate, deal } = input;
  const sources: SkillSource[] = [];
  const adjustments = deal.adjustments ?? [];
  const refs = deal.sourceRefs ?? {};

  // EBITDA bridge — a CALCULATION from listed adjustments; the seller's number is only a claim to reconcile.
  const reported = typeof deal.reportedEbitda === "number" ? deal.reportedEbitda : null;
  const adjSum = adjustments.reduce((s, a) => s + a.amount, 0);
  const computedAdjusted = reported !== null ? round1(reported + adjSum) : null;
  const stated = typeof deal.statedAdjustedEbitda === "number" ? deal.statedAdjustedEbitda : null;
  const reconciles = computedAdjusted !== null && stated !== null ? Math.abs(computedAdjusted - stated) < 0.05 : null;
  const share = reported !== null && reported !== 0 ? round1((Math.abs(adjSum) / Math.abs(reported)) * 100) : null;

  // The mandate tests "LTM adjusted EBITDA": use the derived figure when the bridge exists, else a supplied ebitda.
  const facts: DealFacts = { ...deal };
  delete (facts as Record<string, unknown>).name;
  if (computedAdjusted !== null) facts.ebitda = computedAdjusted;
  if (computedAdjusted !== null) {
    sources.push({ label: "Adjusted EBITDA", kind: "calculation", value: computedAdjusted, ref: "reportedEbitda + sum(adjustments)" });
  }
  for (const a of adjustments) sources.push({ label: `Adjustment: ${a.label}`, kind: "fact", value: a.amount, ref: a.sourceRef });
  if (reported !== null) sources.push({ label: "Reported EBITDA", kind: "fact", value: reported, ref: refs.reportedEbitda });

  const outcome = screenAgainstMandate(mandate, facts);

  // Headline numbers and their grade — no reference, no grade.
  const numbers: FirstLookOutput["numbers"] = [];
  const unsourced: string[] = [];
  for (const m of HEADLINE) {
    const v = facts[m];
    if (typeof v !== "number") continue;
    const ref = refs[m] ?? (m === "ebitda" ? refs.reportedEbitda : undefined) ?? null;
    numbers.push({ metric: m, value: v, sourceRef: ref, grade: ref ? "sourced" : "U" });
    if (!ref) unsourced.push(m);
  }
  const unlistedAdj = adjustments.filter((a) => !a.sourceRef).map((a) => a.label);
  for (const l of unlistedAdj) unsourced.push(`adjustment: ${l}`);

  // Why it could fail — deterministic, in order of severity.
  const reasons: string[] = [];
  for (const c of [...outcome.hardFails, ...outcome.killFactsTriggered]) reasons.push(c.reason);
  if (share !== null && share >= 20) reasons.push(`Adjustments are ${share}% of reported EBITDA — quality of earnings is the first thing to test (heuristic threshold, not a mandate rule).`);
  if (stated !== null && reconciles === false) reasons.push(`Seller's adjusted EBITDA ${stated} does not reconcile to the listed adjustments (${computedAdjusted}).`);
  const weakPrefs = outcome.criteria.filter((c) => c.kind === "preference" && c.fit === "outside");
  for (const c of weakPrefs) reasons.push(c.reason);
  for (const m of outcome.needsData.slice(0, 3)) reasons.push(m);
  const threeReasons = reasons.slice(0, 3);

  // The facts that would kill it — kill facts not yet triggered (still live) or untestable.
  const liveKills = mandate.killFacts.filter((k) => !outcome.killFactsTriggered.some((t) => t.id === k.id)).map((k) => k.label);
  const threeKills = liveKills.slice(0, 3);

  // View.
  let view: FirstLookView;
  let reason: string;
  if (outcome.result === "fail") {
    view = "no-go";
    reason = `Fails the mandate: ${[...outcome.hardFails, ...outcome.killFactsTriggered][0].reason}`;
  } else if (outcome.result === "needs-data") {
    view = "ask-more";
    reason = `A hard limit cannot be tested yet: ${outcome.needsData[0] ?? "data missing"}`;
  } else if (unsourced.length > 0) {
    view = "ask-more";
    reason = `Clears the mandate screen, but ${unsourced.length} number(s) carry no source reference and cannot support a go.`;
  } else {
    view = "go";
    reason = `Clears every hard limit and kill fact${outcome.score !== null ? ` with a preference score of ${outcome.score}/100` : ""}; every headline number is sourced.`;
  }

  const gateOwner = input.gateOwner?.trim() || "The deal lead";
  const gate = `${gateOwner} owns the go / no-go. A CIM is written by the seller to sell; this reads what is there and cannot test what it leaves out.`;

  const structured: FirstLookOutput = {
    view,
    reason,
    numbers,
    ebitdaBridge: { reported, adjustments, adjusted: computedAdjusted, adjustmentsShareOfReported: share, reconciles },
    mandateResult: outcome.result,
    basis: outcome.basis,
    threeReasonsItCouldFail: threeReasons,
    threeFactsThatWouldKillIt: threeKills,
    unsourcedNumbers: unsourced,
    gate,
  };

  const headlineSupplied = numbers.length;
  const completeness = Math.round((headlineSupplied / HEADLINE.length) * 100) / 100;
  const narrative = `First look at ${deal.name}: ${view.toUpperCase()}. ${reason} (${outcome.basis}). ${gate}`;

  return {
    structured,
    narrative,
    sources,
    confidence: Math.max(0.2, Math.min(0.9, 0.35 + completeness * 0.4 + (unsourced.length === 0 ? 0.15 : 0))),
    completeness,
    missingData: [...outcome.needsData, ...unsourced.map((u) => `No source reference: ${u}`)],
  };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["mandate", "deal"],
  properties: {
    mandate: mandateTestsSchema,
    deal: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        ...dealFactsProperties,
        reportedEbitda: { type: "number" },
        statedAdjustedEbitda: { type: "number" },
        adjustments: {
          type: "array",
          items: { type: "object", required: ["label", "amount"], properties: { label: { type: "string", minLength: 1 }, amount: { type: "number" }, sourceRef: { type: "string" } } },
        },
        sourceRefs: { type: "object" },
      },
    },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["view", "reason", "ebitdaBridge", "mandateResult", "basis", "threeReasonsItCouldFail", "threeFactsThatWouldKillIt", "gate"],
  properties: {
    view: { type: "string", enum: ["go", "no-go", "ask-more"] },
    reason: { type: "string" },
    numbers: { type: "array", items: { type: "object", required: ["metric", "grade"] } },
    ebitdaBridge: { type: "object" },
    mandateResult: { type: "string", enum: ["pass", "fail", "needs-data"] },
    basis: { type: "string", enum: ["approved-mandate", "default-screened"] },
    threeReasonsItCouldFail: { type: "array", items: { type: "string" } },
    threeFactsThatWouldKillIt: { type: "array", items: { type: "string" } },
    unsourcedNumbers: { type: "array", items: { type: "string" } },
    gate: { type: "string" },
  },
};

export const firstLookManifest: SkillManifest = {
  id: "first-look",
  name: "First Look Screen",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["deal_sourcer", "analyst", "investment_committee"],
  supportedEntityTypes: ["deal", "company"],
  requiredInputs: ["mandate", "deal.name"],
  optionalInputs: ["deal.reportedEbitda", "deal.adjustments", "deal.statedAdjustedEbitda", "deal.sourceRefs", "gateOwner"],
  outputs: ["view", "reason", "ebitdaBridge", "threeReasonsItCouldFail", "threeFactsThatWouldKillIt", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "mandate:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "adjustments listed individually", "no go on unsourced numbers"],
  evaluationCriteria: ["no-go on hard-limit fail", "ask-more on untestable hard limit", "go requires sourced headline numbers", "adjusted EBITDA is a calculation"],
  providerCapabilities: ["structured_extraction", "financial_reasoning"],
  allowedDownstreamSkills: ["screen-deal", "returns", "dd-checklist", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const firstLook: SkillDefinition<FirstLookInput, FirstLookOutput> = { manifest: firstLookManifest, run };
