// lib/skills/registry.ts
// The native skill registry — the pluggable seam (mirrors lib/agents.ts and the
// intelligence provider registry). A new skill is added by implementing a
// SkillDefinition and registering it here. The registry is a TypeScript catalog
// (dependency-free, statically typed); the authoring spec for each skill lives
// under /skills/<id>/ (SKILL.md, skill.yaml, *.schema.json) and a test asserts
// the two stay consistent.

import type { SkillDefinition, SkillManifest } from "./types";
import { screenDeal } from "./catalog/screen-deal";
import { returns } from "./catalog/returns";
import { ddChecklist } from "./catalog/dd-checklist";
import { icMemo } from "./catalog/ic-memo";
import { comps } from "./catalog/comps";
import { dcf } from "./catalog/dcf";
import { unitEconomics } from "./catalog/unit-economics";
import { capitalCall } from "./catalog/capital-call";
import { lpUpdate } from "./catalog/lp-update";
import { distributionNotice } from "./catalog/distribution-notice";
import { reconcile } from "./catalog/reconcile";
import { navReview } from "./catalog/nav-review";
import { closePeriod } from "./catalog/close-period";
import { portfolioReview } from "./catalog/portfolio-review";
import { valueCreation } from "./catalog/value-creation";
import { kpiIngest } from "./catalog/kpi-ingest";
import { sourceDeals } from "./catalog/source-deals";
import { buyerList } from "./catalog/buyer-list";
import { marketMap } from "./catalog/market-map";
import { kycScreen } from "./catalog/kyc-screen";
import { policyCheck } from "./catalog/policy-check";
import { riskRegister } from "./catalog/risk-register";
import { closingChecklist } from "./catalog/closing-checklist";
import { dealTracker } from "./catalog/deal-tracker";
import { investorProfile } from "./catalog/investor-profile";
import { raisePipeline } from "./catalog/raise-pipeline";
import { commitmentTracker } from "./catalog/commitment-tracker";
import { teaser } from "./catalog/teaser";
import { lbo } from "./catalog/lbo";
import { threeStatement } from "./catalog/three-statement";
import { modelAudit } from "./catalog/model-audit";
import { ddPrep } from "./catalog/dd-prep";
import { auditStatement } from "./catalog/audit-statement";
import { sectorResearch } from "./catalog/sector-research";
import { cim } from "./catalog/cim";

const SKILLS: Record<string, SkillDefinition> = {
  [screenDeal.manifest.id]: screenDeal as SkillDefinition,
  [returns.manifest.id]: returns as SkillDefinition,
  [ddChecklist.manifest.id]: ddChecklist as SkillDefinition,
  [icMemo.manifest.id]: icMemo as SkillDefinition,
  // Phase 2 — financial analysis.
  [comps.manifest.id]: comps as SkillDefinition,
  [dcf.manifest.id]: dcf as SkillDefinition,
  [unitEconomics.manifest.id]: unitEconomics as SkillDefinition,
  // Phase 3 — capital & LP operations (all draft-only; sends/moves stay human).
  [capitalCall.manifest.id]: capitalCall as SkillDefinition,
  [lpUpdate.manifest.id]: lpUpdate as SkillDefinition,
  [distributionNotice.manifest.id]: distributionNotice as SkillDefinition,
  // Phase 4 — fund administration (prepare-only; post/close/NAV-approval stay human).
  [reconcile.manifest.id]: reconcile as SkillDefinition,
  [navReview.manifest.id]: navReview as SkillDefinition,
  [closePeriod.manifest.id]: closePeriod as SkillDefinition,
  // Phase 5 — portfolio operations.
  [portfolioReview.manifest.id]: portfolioReview as SkillDefinition,
  [valueCreation.manifest.id]: valueCreation as SkillDefinition,
  [kpiIngest.manifest.id]: kpiIngest as SkillDefinition,
  // Source intelligence (rank supplied sets; never fabricate companies/buyers).
  [sourceDeals.manifest.id]: sourceDeals as SkillDefinition,
  [buyerList.manifest.id]: buyerList as SkillDefinition,
  [marketMap.manifest.id]: marketMap as SkillDefinition,
  // Risk & compliance (screen + escalate; never the final determination).
  [kycScreen.manifest.id]: kycScreen as SkillDefinition,
  [policyCheck.manifest.id]: policyCheck as SkillDefinition,
  [riskRegister.manifest.id]: riskRegister as SkillDefinition,
  // Legal & closing (coordinate + track; never signs, executes, or auto-closes).
  [closingChecklist.manifest.id]: closingChecklist as SkillDefinition,
  [dealTracker.manifest.id]: dealTracker as SkillDefinition,
  // Capital formation & IR (profile, pipeline, track; never binds or calls capital).
  [investorProfile.manifest.id]: investorProfile as SkillDefinition,
  [raisePipeline.manifest.id]: raisePipeline as SkillDefinition,
  [commitmentTracker.manifest.id]: commitmentTracker as SkillDefinition,
  // Communications (draft-only; never distributes or publishes externally).
  [teaser.manifest.id]: teaser as SkillDefinition,
  // Analyst modeling (compute from supplied assumptions; never invent a figure).
  [lbo.manifest.id]: lbo as SkillDefinition,
  [threeStatement.manifest.id]: threeStatement as SkillDefinition,
  [modelAudit.manifest.id]: modelAudit as SkillDefinition,
  // Diligence prep (sequence a workplan; never performs diligence or sends requests).
  [ddPrep.manifest.id]: ddPrep as SkillDefinition,
  // Fund admin audit support (tie-out; never issues an opinion or signs off).
  [auditStatement.manifest.id]: auditStatement as SkillDefinition,
  // Research (organize supplied findings + grade sources; never fabricates market data).
  [sectorResearch.manifest.id]: sectorResearch as SkillDefinition,
  // Communications CIM (draft-only; never invents financials or distributes).
  [cim.manifest.id]: cim as SkillDefinition,
};

export function getSkill(id: string): SkillDefinition | null {
  return SKILLS[id] ?? null;
}

export function listSkills(): SkillDefinition[] {
  return Object.values(SKILLS);
}

export function listSkillManifests(): SkillManifest[] {
  return Object.values(SKILLS).map((s) => s.manifest);
}
