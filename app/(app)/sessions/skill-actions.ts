"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { canRunSkill, type ExecutiveKey } from "@/lib/executives/registry";
import { getSkill } from "@/lib/skills/registry";
import { runSkillAttached } from "@/lib/skills/session-run";
import type { SkillResult } from "@/lib/skills/types";

// Run a governed skill inside a session with EXPLICIT structured input. The skill
// runtime validates the input, checks the executive is permitted, runs the
// deterministic core, and (on success) attaches an artifact + skill_run to the
// session so it surfaces in the "Skills at work" evidence panel and the artifact
// UI. Org-scoped (defense-in-depth alongside RLS). Never runs on fabricated input.

export interface RunSkillActionResult {
  ok: boolean;
  error?: string;
  result?: SkillResult;
  artifactId?: string | null;
}

export async function runSkillInSession(args: {
  sessionId: string;
  workflowTaskId?: string | null;
  skillId: string;
  executive: ExecutiveKey;
  input: unknown;
}): Promise<RunSkillActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authenticated" };

  const skill = getSkill(args.skillId);
  if (!skill) return { ok: false, error: `Unknown skill: ${args.skillId}` };

  // Authorization is also enforced inside the runtime; check here for a clean
  // early error before any work.
  if (!canRunSkill(args.executive, args.skillId)) {
    return { ok: false, error: `${args.executive} is not permitted to run ${args.skillId}` };
  }

  const { result, artifactId } = await runSkillAttached({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    skillId: args.skillId,
    input: args.input,
    executive: args.executive,
    sessionId: args.sessionId,
    workflowTaskId: args.workflowTaskId ?? null,
  });

  revalidatePath(`/session/${args.sessionId}`);
  return { ok: result.ok, error: result.ok ? undefined : result.warnings.join("; "), result, artifactId };
}
