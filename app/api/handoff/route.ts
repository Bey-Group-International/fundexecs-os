import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { handoffTask } from "@/lib/engine";
import type { AgentKey } from "@/lib/supabase/database.types";

// POST /api/handoff — transfer a task to another agent.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = await request.json().catch(() => null);
  if (!payload?.task_id || !payload?.to_agent) {
    return NextResponse.json(
      { error: "Required: task_id, to_agent" },
      { status: 400 },
    );
  }

  const supabase = createServerClient();
  await handoffTask(
    { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId },
    {
      taskId: String(payload.task_id),
      toAgent: payload.to_agent as AgentKey,
      reason: payload.reason,
    },
  );
  return NextResponse.json({ ok: true });
}
