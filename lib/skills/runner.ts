// lib/skills/runner.ts
// The skill runtime — the governed execution wrapper. It enforces the contract
// every skill run must satisfy before it counts as "done": the executive is
// permitted, inputs validate, the core runs, outputs validate, an approval tier
// is resolved, and the run is persisted with provenance + an audit event.
//
// `executeSkillCore` is PURE (no I/O) so the whole governance path is testable
// without a database; `runSkill` adds persistence + audit on top.

import type { GateTier } from "@/lib/gates";
import { canExecutiveActAt, canRunSkill } from "@/lib/executives/registry";
import { EXECUTIVE_BY_KEY } from "@/lib/executives/registry";
import { getSkill } from "./registry";
import { validate } from "./validate";
import type { SkillContext, SkillResult } from "./types";

function failed(skillId: string, version: string, status: SkillResult["status"], warning: string, extra?: Partial<SkillResult>): SkillResult {
  return {
    ok: false,
    skillId,
    version,
    status,
    structured: null,
    narrative: "",
    sources: [],
    confidence: 0,
    completeness: 0,
    missingData: [],
    approvalTier: 1,
    requiresApproval: false,
    inputValidation: { valid: true, errors: [] },
    outputValidation: { valid: true, errors: [] },
    warnings: [warning],
    ...extra,
  };
}

/**
 * Run a skill's governed core with no I/O. Returns a fully-formed SkillResult,
 * including validation outcomes and the resolved approval tier. Never throws.
 */
export function executeSkillCore(skillId: string, rawInput: unknown, ctx: SkillContext): SkillResult {
  const skill = getSkill(skillId);
  if (!skill) return failed(skillId, "0.0.0", "failed", `Unknown skill: ${skillId}`);
  const { manifest } = skill;

  // 1. Authorization — the assigned executive must be permitted to run this skill.
  if (!canRunSkill(ctx.executive, skillId)) {
    return failed(skillId, manifest.version, "rejected", `Executive ${ctx.executive} is not permitted to run ${skillId}.`);
  }

  // 2. Input validation — a skill never runs on invalid input.
  const inputValidation = validate(rawInput, manifest.inputSchema);
  if (!inputValidation.valid) {
    return failed(skillId, manifest.version, "failed", "Input failed schema validation.", { inputValidation });
  }

  // 3. Run the deterministic core.
  let core;
  try {
    core = skill.run(rawInput, ctx);
  } catch (e) {
    return failed(skillId, manifest.version, "failed", `Skill core threw: ${e instanceof Error ? e.message : "unknown"}`);
  }

  // 4. Output validation.
  const outputValidation = validate(core.structured, manifest.outputSchema);

  // 5. Approval tier — the skill's declared tier, escalated when the executive's
  //    ceiling can't cover it. Tier 3 always requires a human (canExecutiveActAt).
  const approvalTier: GateTier = manifest.approvalTier;
  const requiresApproval = approvalTier >= 2 || !canExecutiveActAt(ctx.executive, approvalTier);

  const warnings: string[] = [];
  if (!outputValidation.valid) warnings.push("Output failed schema validation.");
  if (core.missingData.length) warnings.push(`Missing inputs flagged: ${core.missingData.join(", ")}.`);

  return {
    ok: outputValidation.valid,
    skillId,
    version: manifest.version,
    status: outputValidation.valid ? "succeeded" : "failed",
    structured: core.structured,
    narrative: core.narrative,
    sources: core.sources,
    confidence: core.confidence,
    completeness: core.completeness,
    missingData: core.missingData,
    approvalTier,
    requiresApproval,
    inputValidation,
    outputValidation,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Persisted run (server-only): executeSkillCore + skill_runs + audit event.
// Imported lazily so the pure path above stays free of server/DB imports.
// ---------------------------------------------------------------------------

export async function runSkill(skillId: string, rawInput: unknown, ctx: SkillContext): Promise<SkillResult> {
  const result = executeSkillCore(skillId, rawInput, ctx);

  const skill = getSkill(skillId);
  const backingAgent = EXECUTIVE_BY_KEY[ctx.executive]?.backingAgent ?? null;

  // Persistence + audit are best-effort: a bookkeeping failure never changes the
  // computed result the caller receives.
  try {
    const { persistSkillRun } = await import("./store");
    await persistSkillRun(ctx, {
      skillId,
      skillVersion: result.version,
      backingAgent,
      risk: skill?.manifest.riskClassification ?? "low",
      input: rawInput,
      result,
    });
  } catch {
    // swallow — result already computed.
  }

  return result;
}
