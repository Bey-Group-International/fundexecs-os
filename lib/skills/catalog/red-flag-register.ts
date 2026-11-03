// lib/skills/catalog/red-flag-register.ts
// Red Flag Register (PE department · Due Diligence 08). Pulls findings from every
// diligence workstream into one register: de-duplicated, ranked by impact on the
// decision and price, with the evidence grade each rests on. Names the workstreams
// that did not run (blind spots) and runs a rule-based challenge pass. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { canSupportPrice, gradeOf, mustLabelUntested, EVIDENCE_GRADES, type EvidenceGrade } from "@/lib/pe/evidence";

export type Impact = "walk-away" | "price" | "structure" | "spa-protection" | "100-day";
const IMPACT_ORDER: Impact[] = ["walk-away", "price", "structure", "spa-protection", "100-day"];

export interface FindingIn {
  title: string;
  workstream: string;
  severity: "red" | "amber";
  impact: Impact;
  evidenceGrade?: EvidenceGrade;
  /** Price effect, positive = reduces price. Meaningful for impact "price". */
  priceImpact?: number;
  treatment?: string;
  owner?: string;
  sourceRef?: string;
}

export interface RedFlagInput {
  findings: FindingIn[];
  workstreamsRun: string[];
  /** Defaults to the seven standard workstreams. */
  expectedWorkstreams?: string[];
  gateOwner?: string;
}

export interface RegisterEntry {
  rank: number;
  title: string;
  workstreams: string[];
  severity: "red" | "amber";
  impact: Impact;
  /** The weakest grade among merged duplicates — conservative. */
  evidenceGrade: EvidenceGrade;
  untested: boolean;
  priceImpact: number | null;
  treatment: string | null;
  owner: string | null;
  sourceRefs: string[];
}

export interface RedFlagOutput {
  register: RegisterEntry[];
  duplicatesMerged: number;
  blindSpots: string[];
  /** Price effect from price items whose evidence can support a price (A/B). */
  supportedPriceAdjustment: number;
  /** Price claims resting on C / U evidence — NOT usable as a price adjustment. */
  unsupportedPriceClaims: Array<{ title: string; priceImpact: number; evidenceGrade: EvidenceGrade }>;
  challenges: string[];
  challengeNote: string;
  gate: string;
}

const DEFAULT_WORKSTREAMS = ["commercial", "financial", "revenue-quality", "legal", "tax", "operational", "technology"];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const GRADE_RANK: Record<EvidenceGrade, number> = { A: 0, B: 1, C: 2, U: 3 };

const run: SkillCore<RedFlagInput, RedFlagOutput> = (input): SkillCoreResult<RedFlagOutput> => {
  const sources: SkillSource[] = [];

  // De-duplicate by normalised title, keeping worst case.
  const merged = new Map<string, { f: FindingIn; workstreams: Set<string>; refs: Set<string>; grade: EvidenceGrade }>();
  for (const f of input.findings) {
    const key = norm(f.title);
    const grade = gradeOf(f.evidenceGrade);
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { f: { ...f }, workstreams: new Set([f.workstream]), refs: new Set(f.sourceRef ? [f.sourceRef] : []), grade });
      continue;
    }
    cur.workstreams.add(f.workstream);
    if (f.sourceRef) cur.refs.add(f.sourceRef);
    if (f.severity === "red") cur.f.severity = "red";
    if (IMPACT_ORDER.indexOf(f.impact) < IMPACT_ORDER.indexOf(cur.f.impact)) cur.f.impact = f.impact;
    if (GRADE_RANK[grade] > GRADE_RANK[cur.grade]) cur.grade = grade;
    if ((f.priceImpact ?? 0) > (cur.f.priceImpact ?? 0)) cur.f.priceImpact = f.priceImpact;
    cur.f.treatment = cur.f.treatment ?? f.treatment;
    cur.f.owner = cur.f.owner ?? f.owner;
  }
  const duplicatesMerged = input.findings.length - merged.size;

  const sorted = [...merged.values()].sort(
    (a, b) =>
      IMPACT_ORDER.indexOf(a.f.impact) - IMPACT_ORDER.indexOf(b.f.impact) ||
      (a.f.severity === b.f.severity ? 0 : a.f.severity === "red" ? -1 : 1) ||
      (b.f.priceImpact ?? 0) - (a.f.priceImpact ?? 0) ||
      a.f.title.localeCompare(b.f.title),
  );

  const register: RegisterEntry[] = sorted.map((m, i) => ({
    rank: i + 1,
    title: m.f.title,
    workstreams: [...m.workstreams].sort(),
    severity: m.f.severity,
    impact: m.f.impact,
    evidenceGrade: m.grade,
    untested: mustLabelUntested(m.grade),
    priceImpact: m.f.priceImpact ?? null,
    treatment: m.f.treatment?.trim() || null,
    owner: m.f.owner?.trim() || null,
    sourceRefs: [...m.refs],
  }));

  const expected = input.expectedWorkstreams?.length ? input.expectedWorkstreams : DEFAULT_WORKSTREAMS;
  const ran = new Set(input.workstreamsRun.map(norm));
  const blindSpots = expected.filter((w) => !ran.has(norm(w)));

  let supportedPriceAdjustment = 0;
  const unsupportedPriceClaims: RedFlagOutput["unsupportedPriceClaims"] = [];
  for (const e of register) {
    if (e.impact !== "price" || e.priceImpact === null) continue;
    if (canSupportPrice(e.evidenceGrade)) {
      supportedPriceAdjustment += e.priceImpact;
      sources.push({ label: `Price adjustment: ${e.title}`, kind: "fact", value: e.priceImpact, ref: e.sourceRefs.join("; ") || undefined });
    } else {
      unsupportedPriceClaims.push({ title: e.title, priceImpact: e.priceImpact, evidenceGrade: e.evidenceGrade });
    }
  }
  supportedPriceAdjustment = Math.round(supportedPriceAdjustment * 100) / 100;

  // Rule-based challenge pass — the sceptical reader's strongest points.
  const challenges: string[] = [];
  for (const e of register) {
    if ((e.impact === "walk-away" || e.impact === "price") && !canSupportPrice(e.evidenceGrade)) {
      challenges.push(`"${e.title}" drives a ${e.impact} decision but rests on grade ${e.evidenceGrade} evidence${e.untested ? " (untested)" : ""}.`);
    }
    if (e.impact === "price" && e.priceImpact === null) challenges.push(`"${e.title}" is a price item with no amount.`);
    if (e.severity === "red" && !e.treatment) challenges.push(`Red finding "${e.title}" has no proposed treatment.`);
  }
  for (const w of blindSpots) challenges.push(`Workstream "${w}" has not run — anything it would find is a blind spot.`);
  const top = challenges.slice(0, 5);

  const gateOwner = input.gateOwner?.trim() || "The deal lead and a partner";
  const gate = `${gateOwner} agree the treatment for every walk-away and price item.`;
  const challengeNote = "Rule-based self-check only. For IC, run the Adversarial Pass on a second model.";

  const walk = register.filter((e) => e.impact === "walk-away").length;
  const narrative =
    `Red flag register: ${register.length} finding(s) (${walk} walk-away), ${duplicatesMerged} duplicate(s) merged, ${blindSpots.length} blind-spot workstream(s). ` +
    `Supported price adjustment ${supportedPriceAdjustment}; ${unsupportedPriceClaims.length} price claim(s) excluded for weak evidence. ${gate}`;

  const completeness = Math.round(((expected.length - blindSpots.length) / expected.length) * 100) / 100;
  return {
    structured: { register, duplicatesMerged, blindSpots, supportedPriceAdjustment, unsupportedPriceClaims, challenges: top, challengeNote, gate },
    narrative,
    sources,
    confidence: Math.max(0.25, Math.min(0.9, 0.3 + completeness * 0.5)),
    completeness,
    missingData: blindSpots.map((w) => `Workstream not run: ${w}`),
  };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["findings", "workstreamsRun"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "workstream", "severity", "impact"],
        properties: {
          title: { type: "string", minLength: 1 },
          workstream: { type: "string", minLength: 1 },
          severity: { type: "string", enum: ["red", "amber"] },
          impact: { type: "string", enum: IMPACT_ORDER },
          evidenceGrade: { type: "string", enum: [...EVIDENCE_GRADES] },
          priceImpact: { type: "number" },
          treatment: { type: "string" },
          owner: { type: "string" },
          sourceRef: { type: "string" },
        },
      },
    },
    workstreamsRun: { type: "array", items: { type: "string" } },
    expectedWorkstreams: { type: "array", items: { type: "string" } },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["register", "blindSpots", "supportedPriceAdjustment", "unsupportedPriceClaims", "challenges", "gate"],
  properties: {
    register: { type: "array", items: { type: "object", required: ["rank", "title", "severity", "impact", "evidenceGrade"] } },
    duplicatesMerged: { type: "integer" },
    blindSpots: { type: "array", items: { type: "string" } },
    supportedPriceAdjustment: { type: "number" },
    unsupportedPriceClaims: { type: "array", items: { type: "object", required: ["title", "priceImpact", "evidenceGrade"] } },
    challenges: { type: "array", items: { type: "string" } },
    challengeNote: { type: "string" },
    gate: { type: "string" },
  },
};

export const redFlagRegisterManifest: SkillManifest = {
  id: "red-flag-register",
  name: "Red Flag Register",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence", "investment_committee"],
  supportedEntityTypes: ["deal"],
  requiredInputs: ["findings", "workstreamsRun"],
  optionalInputs: ["expectedWorkstreams", "gateOwner"],
  outputs: ["register", "blindSpots", "supportedPriceAdjustment", "unsupportedPriceClaims", "challenges", "gate"],
  artifactTypes: ["risk_report"],
  dataPermissions: ["deal:read", "document:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "weak-evidence price claims excluded from the price adjustment"],
  evaluationCriteria: ["duplicates merged at worst case", "ranked by impact", "blind-spot workstreams named", "C/U evidence cannot support a price"],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["bid-range", "ic-memo"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital", "capital_call"],
  inputSchema,
  outputSchema,
};

export const redFlagRegister: SkillDefinition<RedFlagInput, RedFlagOutput> = { manifest: redFlagRegisterManifest, run };
