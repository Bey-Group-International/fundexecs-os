// lib/skills/catalog/exit-readiness.ts
// Exit Readiness and Equity Story (PE department · Exit 02). Assesses the business
// the way a buyer's diligence will, lists what to fix before launch with owners and
// times, and keeps only equity-story claims that have a proof document. Claims
// without proof are REMOVED and listed, never softened into the story. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { assessReadiness, type ReadinessItemIn, type ReadinessResult } from "@/lib/pe/readiness";
import { readinessItemSchema, readinessResultSchema } from "@/lib/pe/readiness-schema";

export interface ClaimIn {
  claim: string;
  /** The proof document or dataset. */
  proof?: string;
}

export interface ExitReadinessInput {
  company: string;
  items: ReadinessItemIn[];
  equityStory?: ClaimIn[];
  gateOwner?: string;
}

export interface ExitReadinessOutput extends ReadinessResult {
  equityStory: { kept: Array<{ claim: string; proof: string }>; removed: string[]; sizeOk: boolean };
  limitation: string;
  gate: string;
}

const run: SkillCore<ExitReadinessInput, ExitReadinessOutput> = (input): SkillCoreResult<ExitReadinessOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const result = assessReadiness(input.items);

  const kept = (input.equityStory ?? []).filter((c) => c.proof?.trim()).map((c) => ({ claim: c.claim, proof: (c.proof as string).trim() }));
  const removed = (input.equityStory ?? []).filter((c) => !c.proof?.trim()).map((c) => c.claim);
  const sizeOk = kept.length >= 3 && kept.length <= 5;
  if (!input.equityStory?.length) missingData.push("No equity-story claims supplied");
  else if (!sizeOk) missingData.push(`Equity story keeps ${kept.length} proven claim(s); a story needs three to five`);
  for (const c of removed) missingData.push(`Equity-story claim removed for lack of proof: "${c}"`);
  for (const id of result.untimed) missingData.push(`${id}: no time-to-close estimate`);
  for (const k of kept) sources.push({ label: `Equity story: ${k.claim}`, kind: "fact", ref: k.proof });

  const gateOwner = input.gateOwner?.trim() || "The deal lead";
  const gate = `${gateOwner} decides launch timing.`;
  const limitation = "Self-assessment is softer than a buyer's. Ask for the Adversarial Pass to play the buyer's QoE, CDD and legal diligence.";
  const timing =
    result.weeksIfParallel === null
      ? "timing unknown (open items have no estimate)"
      : result.weeksIfParallel === 0
        ? "nothing to fix"
        : `${result.weeksIfParallel} weeks if fixes run in parallel, ${result.weeksIfSerial} if in series`;
  const narrative =
    `Exit readiness, ${input.company}: ${result.ready ? "no launch blockers" : `${result.blockers.length} launch blocker(s)`} — ${timing}. ` +
    `Equity story: ${kept.length} proven claim(s)${removed.length ? `, ${removed.length} removed for no proof` : ""}. ${gate}`;

  const total = result.items.length || 1;
  const completeness = Math.round(((result.counts.met + result.counts.partial + result.counts.gap) / total) * 100) / 100;
  return {
    structured: { ...result, equityStory: { kept, removed, sizeOk }, limitation, gate },
    narrative,
    sources,
    confidence: Math.max(0.25, Math.min(0.85, 0.3 + completeness * 0.5)),
    completeness,
    missingData,
  };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "items"],
  properties: {
    company: { type: "string", minLength: 1 },
    items: { type: "array", items: readinessItemSchema },
    equityStory: { type: "array", items: { type: "object", required: ["claim"], properties: { claim: { type: "string", minLength: 1 }, proof: { type: "string" } } } },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  ...readinessResultSchema,
  required: [...(readinessResultSchema.required ?? []), "equityStory", "limitation", "gate"],
  properties: { ...readinessResultSchema.properties, equityStory: { type: "object", required: ["kept", "removed", "sizeOk"] }, limitation: { type: "string" }, gate: { type: "string" } },
};

export const exitReadinessManifest: SkillManifest = {
  id: "exit-readiness",
  name: "Exit Readiness & Equity Story",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops", "diligence"],
  supportedEntityTypes: ["asset", "company"],
  requiredInputs: ["company", "items"],
  optionalInputs: ["equityStory", "gateOwner"],
  outputs: ["items", "counts", "ready", "blockers", "weeksIfParallel", "weeksIfSerial", "equityStory", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["asset:read", "document:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "met requires evidence", "equity-story claims require proof"],
  evaluationCriteria: ["met without evidence is unverified", "claims without proof removed", "timing reported parallel and serial", "unknown never read as met"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["data-room-prep", "exit-routes", "ipo-readiness"],
  prohibitedActions: ["send_outreach", "distribute_report", "share_materials", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const exitReadiness: SkillDefinition<ExitReadinessInput, ExitReadinessOutput> = { manifest: exitReadinessManifest, run };
