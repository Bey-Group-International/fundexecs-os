// lib/skills/catalog/ipo-readiness.ts
// IPO Readiness (PE department · Exit 07). Assesses readiness for a public listing
// across reporting, governance, controls and the equity story, against the
// requirements the USER names for the target exchange. The skill holds no listing
// rules of its own: a requirement that cites no source rule is flagged, and counsel
// and the sponsor confirm the requirements. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { assessReadiness, type ReadinessItemIn, type ReadinessResult } from "@/lib/pe/readiness";
import { readinessItemSchema, readinessResultSchema } from "@/lib/pe/readiness-schema";

export interface IpoReadinessInput {
  company: string;
  /** Target exchange / segment. The requirements below are the user's reading of its rules. */
  exchange: string;
  items: ReadinessItemIn[];
  gateOwner?: string;
}

export interface IpoReadinessOutput extends ReadinessResult {
  exchange: string;
  uncitedRequirements: string[];
  limitation: string;
  gate: string;
}

const run: SkillCore<IpoReadinessInput, IpoReadinessOutput> = (input): SkillCoreResult<IpoReadinessOutput> => {
  const sources: SkillSource[] = [{ label: "Target exchange", kind: "fact", value: input.exchange }];
  const result = assessReadiness(input.items, { requireSourceRule: true });
  const uncited = result.items.filter((i) => !i.sourceRule?.trim()).map((i) => `${i.area}: ${i.requirement}`);
  for (const i of result.items) if (i.sourceRule?.trim()) sources.push({ label: `${i.area}: ${i.requirement}`, kind: "fact", ref: i.sourceRule.trim() });

  const missingData = [...uncited.map((u) => `No source rule: ${u}`), ...result.untimed.map((id) => `${id}: no time-to-close estimate`)];
  const gateOwner = input.gateOwner?.trim() || "The board";
  const gate = `${gateOwner} decides whether to pursue the listing.`;
  const limitation = "Listing rules differ by exchange and change. This skill assesses against the requirements you supplied; legal counsel and the sponsor confirm them.";
  const timing = result.weeksIfParallel === null ? "timing unknown" : `${result.weeksIfParallel}–${result.weeksIfSerial} weeks to close (parallel–serial)`;
  const narrative = `IPO readiness for ${input.exchange}, ${input.company}: ${result.ready ? "no blockers on the stated requirements" : `${result.blockers.length} blocker(s)`}; ${timing}. ${uncited.length ? `${uncited.length} requirement(s) cite no source rule. ` : ""}${gate}`;

  const total = result.items.length || 1;
  const completeness = Math.round(((total - uncited.length) / total) * 100) / 100;
  return {
    structured: { ...result, exchange: input.exchange, uncitedRequirements: uncited, limitation, gate },
    narrative,
    sources,
    confidence: Math.max(0.25, Math.min(0.8, 0.3 + completeness * 0.45)),
    completeness,
    missingData,
  };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "exchange", "items"],
  properties: { company: { type: "string", minLength: 1 }, exchange: { type: "string", minLength: 1 }, items: { type: "array", items: readinessItemSchema }, gateOwner: { type: "string" } },
};

const outputSchema: JsonSchema = {
  ...readinessResultSchema,
  required: [...(readinessResultSchema.required ?? []), "exchange", "uncitedRequirements", "limitation", "gate"],
  properties: { ...readinessResultSchema.properties, exchange: { type: "string" }, uncitedRequirements: { type: "array", items: { type: "string" } }, limitation: { type: "string" }, gate: { type: "string" } },
};

export const ipoReadinessManifest: SkillManifest = {
  id: "ipo-readiness",
  name: "IPO Readiness",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops", "legal_closing"],
  supportedEntityTypes: ["asset", "company"],
  requiredInputs: ["company", "exchange", "items"],
  optionalInputs: ["gateOwner"],
  outputs: ["items", "counts", "ready", "blockers", "weeksIfParallel", "weeksIfSerial", "uncitedRequirements", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["asset:read", "document:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "each requirement cites its source rule", "each gap has a time estimate"],
  evaluationCriteria: ["uncited requirement flagged", "met without evidence unverified", "no built-in listing rules", "timing parallel and serial"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["exit-routes", "final-investment-report"],
  prohibitedActions: ["send_outreach", "distribute_report", "share_materials", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const ipoReadiness: SkillDefinition<IpoReadinessInput, IpoReadinessOutput> = { manifest: ipoReadinessManifest, run };
