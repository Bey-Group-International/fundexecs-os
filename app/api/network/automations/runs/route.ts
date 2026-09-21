// What the rules actually did.
//
// The single most useful thing about an automation is being able to answer
// "why did this task appear on my queue?". Every firing writes a row here —
// which rule, which deal, which actions, and whether each one worked — and the
// whole org can read it. A rule nobody can audit is a rule nobody trusts.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { mapAutomationRun } from "@/lib/network-automations";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

const RUN_SELECT =
  "id, automation_id, entity_type, entity_id, entity_label, status, results, error, created_at, " +
  "network_automations(name)";

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = req.nextUrl.searchParams;
  const parsed = parseInt(sp.get("limit") ?? "25", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : 25;

  const supabase = (await createServerClient()) as any;

  let query = supabase
    .from("network_automation_runs")
    .select(RUN_SELECT)
    .eq("organization_id", auth.ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Narrow to one rule (the builder's "what has this done?" panel) or to one
  // row (the record page's "why is this here?").
  const automationId = sp.get("automationId");
  if (automationId) query = query.eq("automation_id", automationId);

  const entityId = sp.get("entityId");
  if (entityId) query = query.eq("entity_id", entityId);

  const status = sp.get("status");
  if (status === "applied" || status === "skipped" || status === "failed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[network/automations/runs]", error);
    return NextResponse.json({ error: "Failed to read the run log" }, { status: 500 });
  }

  return NextResponse.json({
    runs: ((data ?? []) as Record<string, unknown>[]).map(mapAutomationRun),
  });
}
