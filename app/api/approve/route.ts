import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { decideApproval } from "@/lib/engine";
import { isExecutive } from "@/lib/intelligence";

// Approval triggers step execution, which calls Claude per step.
export const maxDuration = 300;

const DECISIONS = ["approved", "rejected", "regenerate", "accepted"] as const;
type Decision = (typeof DECISIONS)[number];

// POST /api/approve — capture the human decision on an approval request.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = await request.json().catch(() => null);
  const decision = payload?.decision as Decision;
  if (!payload?.approval_id || !DECISIONS.includes(decision)) {
    return NextResponse.json(
      { error: "Required: approval_id, decision (approved|rejected|regenerate|accepted)" },
      { status: 400 },
    );
  }

  // On a re-route, the operator may delegate the rebuilt plan to a desk.
  const desk = isExecutive(payload.delegate) ? payload.delegate : undefined;

  const supabase = createServerClient();
  const result = await decideApproval(
    { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId },
    { approvalId: String(payload.approval_id), decision, note: payload.note, delegate: desk },
  );
  return NextResponse.json(result);
}
