"use server";

import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { decideApproval } from "@/lib/engine";
import { recordOperatorFeedback } from "@/lib/team-tasks";

type Decision = "approved" | "rejected" | "regenerate";

// Capture an approval decision from the mobile swipe-to-decide flow. Mirrors the
// dock's approveRun/dismissRun best-effort behavior and the /api/approve route,
// reusing the same decideApproval engine entrypoint so mobile and desktop share
// one decision path (idempotency guard, execution, audit).
export async function decideApprovalAction(
  approvalId: string,
  decision: Decision,
  note?: string,
): Promise<{ ok: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false };
  if (!approvalId) return { ok: false };
  const supabase = await createServerClient();
  try {
    await decideApproval(
      { supabase, orgId: ctx.orgId, actorId: ctx.userId },
      { approvalId, decision, note },
    );
    await recordOperatorFeedback(supabase, [
      {
        organizationId: ctx.orgId,
        principalId: ctx.userId,
        signal:
          decision === "approved"
            ? "approval_approved"
            : decision === "regenerate"
              ? "approval_regenerate"
              : "approval_rejected",
        subject: "Mobile approval decision",
        scope: "mobile/approvals",
        agent: "associate",
      },
    ]);
    return { ok: true };
  } catch {
    // Best-effort: the row stays pending and the operator can retry.
    return { ok: false };
  }
}
