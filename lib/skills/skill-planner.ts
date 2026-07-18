// lib/skills/skill-planner.ts
// The seam that lets Earn's engine run a GOVERNED skill in place of a free-text
// generation for a planned step — WITHOUT ever fabricating input. Pure + tested.
//
// `planSkillForStep` answers one question: "can this step run as a native skill on
// REAL structured input we already have?" It returns a plan (skill id + permitted
// executive + assembled input) only when:
//   1. the step clearly IS a skill (detectSkillForStep), and
//   2. the structured context carries the skill's REQUIRED input for real
//      (a company name, a candidate set, usable mandate criteria) — never invented.
// Otherwise it returns null and the engine's normal free-text path runs unchanged.
//
// This is the deliberate answer to "never invent financial values": the planner
// only ever forwards fields that are actually present in the context. A missing
// field is left absent so the skill's own core flags it — it is never filled in.

import type { ExecutiveKey } from "@/lib/executives/registry";
import { detectSkillForStep } from "./engine-bridge";
import { getSkill } from "./registry";
import { hasUsableCriteria, type ScreeningCriteria } from "./screening-criteria";

/** A deal's structured fields, as far as they are actually known. All optional. */
export interface PlanningDeal {
  companyName?: string;
  sector?: string;
  geography?: string;
  revenue?: number;
  ebitda?: number;
  enterpriseValue?: number;
  askingPrice?: number;
  ownership?: string;
  transactionType?: string;
  description?: string;
}

/** A supplied sourcing candidate (name is required; the rest as known). */
export interface PlanningCandidate {
  name: string;
  sector?: string;
  geography?: string;
  revenue?: number;
  ebitda?: number;
  ownership?: string;
  source?: string;
}

/** The real, structured context the engine assembles from mandate + records. */
export interface SkillPlanningContext {
  criteria?: ScreeningCriteria | null;
  deal?: PlanningDeal | null;
  candidates?: PlanningCandidate[] | null;
}

export interface SkillPlan {
  skillId: string;
  executive: ExecutiveKey;
  /** The assembled, real skill input — validated by the runtime before it runs. */
  input: unknown;
}

/** Copy only the DEFINED keys of `src` (a present field is forwarded; an absent one stays absent). */
function present<T extends object>(src: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(src) as Array<keyof T>) {
    if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  }
  return out;
}

/**
 * The plan for a step, or null when the step is not a skill or its required input
 * is not present for real. Each assembler forwards ONLY fields the context holds.
 */
export function planSkillForStep(
  title: string,
  description: string,
  ctx: SkillPlanningContext,
): SkillPlan | null {
  const skillId = detectSkillForStep(title, description);
  if (!skillId) return null;
  const skill = getSkill(skillId);
  if (!skill) return null;
  const executive = skill.manifest.applicableExecutives[0];
  if (!executive) return null;

  const criteria = ctx.criteria ?? null;

  switch (skillId) {
    case "screen-deal": {
      // Screening needs a named deal AND criteria to screen it against. Without a
      // company name we will not invent one; without usable criteria there is
      // nothing to screen against, so we defer to the free-text path.
      const companyName = ctx.deal?.companyName?.trim();
      if (!companyName || !hasUsableCriteria(criteria)) return null;
      const deal = { companyName, ...present({ ...ctx.deal, companyName: undefined }) };
      return { skillId, executive, input: { mandate: criteria ?? {}, deal } };
    }
    case "source-deals": {
      // Ranking needs a supplied candidate set — this skill never fabricates
      // targets, so with no candidates there is nothing to rank.
      const candidates = (ctx.candidates ?? []).filter((c) => c && typeof c.name === "string" && c.name.trim());
      if (candidates.length === 0) return null;
      return {
        skillId,
        executive,
        input: { mandate: criteria ?? {}, candidates: candidates.map((c) => ({ name: c.name.trim(), ...present({ ...c, name: undefined }) })) },
      };
    }
    default:
      // Other detectable skills (returns, ic-memo, dd-checklist) require rich
      // structured input that is not reliably present mid-workflow; running them
      // now would mean fabricating that input, so we defer to the free-text path.
      return null;
  }
}
