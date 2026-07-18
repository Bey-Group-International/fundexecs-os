// lib/skills/config.ts
// Feature switches for the skill runtime. Same discipline as the inference gateway
// and proactive layer: a simple env-string flag, OFF unless explicitly "true", so
// the default behaviour of the engine is byte-for-byte unchanged until an operator
// opts in.

/**
 * When true, the workflow engine may run a GOVERNED skill in place of a free-text
 * step generation — but ONLY when the step maps to a skill and real structured
 * input is present (see lib/skills/skill-planner.ts). Off by default: the engine's
 * existing free-text path runs unchanged, and no skill ever runs on fabricated input.
 */
export const SKILL_AUTOINVOKE_ENABLED = process.env.SKILL_AUTOINVOKE_ENABLED === "true";
