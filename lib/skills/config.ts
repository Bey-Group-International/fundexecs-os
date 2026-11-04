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

/**
 * Per-organization opt-in, for piloting auto-invocation on one org before turning
 * it on everywhere. True when the global flag is on, OR the org's id is listed in
 * SKILL_AUTOINVOKE_ORGS (comma-separated org uuids). Anything else is false, so an
 * unlisted org's engine behaviour is byte-for-byte unchanged. Reads the env at
 * call time (not import time) so it is testable and a redeploy is the only thing
 * that changes who is in the pilot.
 */
export function skillAutoInvokeEnabledFor(orgId: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (env.SKILL_AUTOINVOKE_ENABLED === "true") return true;
  if (!orgId) return false;
  const listed = (env.SKILL_AUTOINVOKE_ORGS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return listed.includes(orgId.trim().toLowerCase());
}
