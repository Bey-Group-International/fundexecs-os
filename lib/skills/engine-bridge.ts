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
  // PE department skills. Specific phrases only, and ahead of the generic rules
  // below ("irr", "screen") so e.g. a bid-range step is not read as a returns case.
  { skillId: "final-investment-report", pattern: /\bfinal\s+investment\s+report\b/i },
  { skillId: "sensitivity", pattern: /\b(sensitivity(\s+(analysis|table|tables))?|break[-\s]?even(s)?(\s+(analysis|multiple|price))?|two[-\s]way\s+table)\b/i },
  { skillId: "bid-range", pattern: /\b(bid\s+(price\s+)?range|walk[-\s]?away\s+price|maximum\s+(bid\s+)?price)\b/i },
  { skillId: "technology-dd", pattern: /\b(technology|tech(nical)?|it)\s+(dd|due\s+diligence|issues?\s+list)\b|\bsecurity\s+posture\b/i },
  { skillId: "tax-dd", pattern: /\btax\s+(dd|due\s+diligence|issues?\s+list|exposures?)\b/i },
  { skillId: "legal-dd", pattern: /\blegal\s+(dd|due\s+diligence|issues?\s+list)\b|\bcontract\s+abstract\b/i },
  { skillId: "red-flag-register", pattern: /\bred[-\s]?flag\s+register\b/i },
  { skillId: "qoe-bridge", pattern: /\b(qoe|quality\s+of\s+earnings|ebitda\s+bridge)\b/i },
  { skillId: "revenue-quality", pattern: /\b(customer\s+concentration|revenue\s+quality|net\s+revenue\s+retention|cohort\s+retention)\b/i },
  { skillId: "covenant-watch", pattern: /\bcovenant\s+(watch|headroom|test(s|ing)?|monitoring)\b/i },
  { skillId: "cash-13-week", pattern: /\b(13|thirteen)[-\s]week\s+(cash|forecast)/i },
  { skillId: "kpi-variance", pattern: /\b(kpi\s+variance|budget[-\s]to[-\s]actual|variance\s+to\s+budget)\b/i },
  { skillId: "debt-structure", pattern: /\bdebt\s+(structure|package|sizing)\b/i },
  { skillId: "financing-terms", pattern: /\b(financing\s+terms|term[-\s]sheet\s+comparison|compare\s+(the\s+)?(lender|term[-\s]sheet)s?)\b/i },
  { skillId: "ipo-readiness", pattern: /\bipo\s+readiness\b/i },
  { skillId: "exit-readiness", pattern: /\b(exit\s+readiness|equity\s+story)\b/i },
  { skillId: "exit-routes", pattern: /\bexit\s+(strategy|routes?|options)\b/i },
  { skillId: "data-room-prep", pattern: /\bdata[-\s]?room\s+(prep|preparation|index)\b/i },
  { skillId: "first-look", pattern: /\b(first[-\s]look|go\s*\/\s*no[-\s]?go)\b/i },
  { skillId: "mandate-screen", pattern: /\b(mandate\s+(screen|definition|tests?)|investment\s+mandate\s+(screen|definition))\b/i },
  { skillId: "target-screen", pattern: /\b(target\s+screening|screen\s+(the\s+|a\s+)?(target|company)\s+list|screen\s+(the\s+)?targets)\b/i },
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
