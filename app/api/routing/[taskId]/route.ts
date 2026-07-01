// app/api/routing/[taskId]/route.ts
// Feature 01 — Agent Routing Console
//
// GET /api/routing/[taskId]
// Returns routing_events for the given task. Requires an authenticated session
// (cookie-bound RLS client). Returns 401 when unauthenticated.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getRoutingTrace } from "@/lib/routing-trace";
import type { RoutingEvent } from "@/lib/routing-trace";

export async function GET(
  _req: NextRequest,
  { params }: { params: { taskId: string } },
): Promise<NextResponse<{ events: RoutingEvent[] } | { error: string }>> {
  // Verify the caller is authenticated via the cookie-bound RLS client.
  const db = createServerClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await getRoutingTrace(params.taskId);
  return NextResponse.json({ events });
}
