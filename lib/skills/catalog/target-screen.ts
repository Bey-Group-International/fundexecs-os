// lib/skills/catalog/target-screen.ts
// Target Screening (PE department · Deal Sourcing 03). Screens a supplied list of
// companies against the mandate tests: hard limits first (a fail ends the screen
// for that company), then scored preferences, with needs-data wherever a field is
// empty. Survivors are ranked by score. Never invents a number to make a company
// pass, and never fabricates a company — it only ranks the list it is given.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { dealFactsProperties, mandateTestsSchema } from "@/lib/pe/mandate-schema";
import { screenAgainstMandate, type DealFacts, type MandateTests, type ScreenResult } from "@/lib/pe/mandate-tests";

export interface ScreenTarget extends DealFacts {
  name: string;
}

export interface TargetScreenInput {
  mandate: MandateTests;
  targets: ScreenTarget[];
  gateOwner?: string;
}

export interface ScreenedTarget {
  rank: number | null;
  name: string;
  result: ScreenResult;
  score: number | null;
  /** Criteria the company failed, each citing the criterion. */
  criteriaFailed: string[];
  /** Fields missing, as reasons. */
  fieldsMissing: string[];
}

export interface TargetScreenOutput {
  results: ScreenedTarget[];
  counts: { pass: number; fail: number; needsData: number };
  basis: "approved-mandate" | "default-screened";
  limitation: string;
  gate: string;
}

const ORDER: Record<ScreenResult, number> = { pass: 0, "needs-data": 1, fail: 2 };

const run: SkillCore<TargetScreenInput, TargetScreenOutput> = (input): SkillCoreResult<TargetScreenOutput> => {
  const { mandate, targets } = input;
  const sources: SkillSource[] = [];

  const screened = targets.map((t) => {
    const { name, ...facts } = t;
    const o = screenAgainstMandate(mandate, facts);
    const row: ScreenedTarget = {
      rank: null,
      name,
      result: o.result,
      score: o.score,
      criteriaFailed: [...o.hardFails, ...o.killFactsTriggered].map((c) => c.reason),
      fieldsMissing: o.needsData,
    };
    return { row, basis: o.basis };
  });

  // Survivors at the top: pass by score desc, then needs-data, then fail.
  const rows = screened
    .map((s) => s.row)
    .sort((a, b) => ORDER[a.result] - ORDER[b.result] || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  let rank = 0;
  for (const r of rows) r.rank = r.result === "pass" ? ++rank : null;

  const counts = {
    pass: rows.filter((r) => r.result === "pass").length,
    fail: rows.filter((r) => r.result === "fail").length,
    needsData: rows.filter((r) => r.result === "needs-data").length,
  };

  const basis = mandate.status === "approved" ? "approved-mandate" : "default-screened";
  const gateOwner = input.gateOwner?.trim() || "An associate";
  const gate = `${gateOwner} reviews every pass before outreach.`;
  const limitation = "The screen is only as good as the list. Private company financials in databases are often estimates. A pass means worth a call, not worth a bid.";

  sources.push({ label: "Targets screened", kind: "fact", value: targets.length });
  sources.push({ label: "Mandate basis", kind: "assumption", value: basis, ref: "mandate.status" });

  const withData = rows.filter((r) => r.fieldsMissing.length === 0).length;
  const completeness = rows.length ? Math.round((withData / rows.length) * 100) / 100 : 0;
  const missingData = Array.from(new Set(rows.flatMap((r) => r.fieldsMissing.map((m) => `${r.name}: ${m}`)))).slice(0, 50);

  const narrative =
    `Screened ${rows.length} target(s) against the mandate (${basis}): ${counts.pass} pass, ${counts.needsData} need data, ${counts.fail} fail. ` +
    `${limitation} ${gate}`;

  return {
    structured: { results: rows, counts, basis, limitation, gate },
    narrative,
    sources,
    confidence: Math.max(0.2, Math.min(0.9, 0.4 + completeness * 0.4 + (basis === "approved-mandate" ? 0.1 : 0))),
    completeness,
    missingData,
  };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["mandate", "targets"],
  properties: {
    mandate: mandateTestsSchema,
    targets: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 }, ...dealFactsProperties } } },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["results", "counts", "basis", "limitation", "gate"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "result"],
        properties: {
          name: { type: "string" },
          result: { type: "string", enum: ["pass", "fail", "needs-data"] },
          score: { type: "number", minimum: 0, maximum: 100 },
          criteriaFailed: { type: "array", items: { type: "string" } },
          fieldsMissing: { type: "array", items: { type: "string" } },
        },
      },
    },
    counts: { type: "object", required: ["pass", "fail", "needsData"] },
    basis: { type: "string", enum: ["approved-mandate", "default-screened"] },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const targetScreenManifest: SkillManifest = {
  id: "target-screen",
  name: "Target Screening",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "source",
  applicableExecutives: ["deal_sourcer", "analyst"],
  supportedEntityTypes: ["company", "mandate"],
  requiredInputs: ["mandate", "targets"],
  optionalInputs: ["gateOwner"],
  outputs: ["results", "counts", "basis", "limitation", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["company:read", "mandate:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no company passed on an inferred number"],
  evaluationCriteria: ["hard-limit fail ends the screen", "empty fields are needs-data not guessed", "every fail cites its criterion", "survivors ranked by score"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["first-look", "screen-deal", "dd-checklist"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const targetScreen: SkillDefinition<TargetScreenInput, TargetScreenOutput> = { manifest: targetScreenManifest, run };
