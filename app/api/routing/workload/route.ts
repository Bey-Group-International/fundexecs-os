// app/api/routing/workload/route.ts
// Feature 01 — Agent Routing Console
//
// GET /api/routing/workload?orgId=X
// Returns per-agent event counts for the last 24 h within the given org.
// Requires an authenticated session.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getAgentWorkload } from "@/lib/routing-trace";

interface WorkloadEntry {
  agent_key: string;
  active_count: number;
}

export async function GET(
  req: NextRequest,
): Promise<NextResponse<{ workload: WorkloadEntry[] } | { error: string }>> {
  // Auth guard.
  const db = createServerClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json(
      { error: "orgId query parameter is required" },
      { status: 400 },
    );
  }

  const workload = await getAgentWorkload(orgId);
  return NextResponse.json({ workload });
}
