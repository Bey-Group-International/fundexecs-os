// lib/skills/engine-bridge.ts
// The bridge between Earn's workflow steps and the skill registry. Pure + tested.
//
// `detectSkillForStep` maps a planned step (free-text title/description) to a
// registered skill id when the step is clearly one of them. This is the seam the
// engine will use to run a governed skill instead of a free-text generation once
// a step also carries STRUCTURED input — deliberately, skills are NOT auto-run on
// fabricated input (that would violate "never invent financial values"), so the
// engine only invokes a detected skill when real structured input is available
// (today: via the session-attached runner with explicit input; next: planner
// step-tagging + structured mandate-criteria / deal-field plumbing).

import { getSkill } from "./registry";

// Ordered, specific → general. First match wins. Patterns are intentionally
// conservative: a step must clearly BE the skill, or detection returns null and
// the normal free-text path runs.
const RULES: Array<{ skillId: string; pattern: RegExp }> = [
  { skillId: "ic-memo", pattern: /\b(ic[-\s]?memo|investment[-\s]committee\s+memo|ic\s+pre[-\s]?read|pre[-\s]?read)\b/i },
  { skillId: "dd-checklist", pattern: /\b(diligence\s+(checklist|request\s+list|list)|dd[-\s]?checklist|due[-\s]diligence\s+(list|checklist))\b/i },
  { skillId: "returns", pattern: /\b(returns?\s+(case|analysis|model)|lbo|irr|moic)\b/i },
  { skillId: "source-deals", pattern: /\b(source\s+(deals?|targets?)|sourcing\s+(list|targets?)|rank\s+(the\s+)?(candidate|target)s?|target\s+shortlist)\b/i },
  { skillId: "screen-deal", pattern: /\b(screen(ing)?|mandate[-\s]?fit|qualify\s+(the\s+)?(deal|opportunity))\b/i },
];

/**
 * The skill id a step maps to, or null when the step is not clearly a skill.
 * Only returns ids that are actually registered.
 */
export function detectSkillForStep(title: string, description = ""): string | null {
  const haystack = `${title} ${description}`;
  for (const rule of RULES) {
    if (rule.pattern.test(haystack) && getSkill(rule.skillId)) return rule.skillId;
  }
  return null;
}
