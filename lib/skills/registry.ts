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
