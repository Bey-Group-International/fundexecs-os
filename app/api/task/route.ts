import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { createTask } from "@/lib/engine";
import type { AgentKey, Hub, GraphKind } from "@/lib/supabase/database.types";

// POST /api/task — create a task directly (bypassing prompt routing).
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = await request.json().catch(() => null);
  if (!payload?.title || !payload?.hub || !payload?.agent) {
    return NextResponse.json(
      { error: "Required: title, hub, agent" },
      { status: 400 },
    );
  }

  const supabase = createServerClient();
  const task = await createTask(
    { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId },
    {
      title: String(payload.title),
      description: payload.description ?? null,
      hub: payload.hub as Hub,
      agent: payload.agent as AgentKey,
      graph: (payload.graph as GraphKind) ?? null,
      requiresApproval: payload.requires_approval ?? true,
    },
  );
  return NextResponse.json({ task }, { status: 201 });
}

// GET /api/task — list tasks for the active org (most recent first).
export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}
