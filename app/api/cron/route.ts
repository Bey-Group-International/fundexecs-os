import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runAutomation } from "@/lib/engine";
import { nextRun } from "@/lib/cron";
import { runSlaEscalations } from "@/lib/sla-cron";
import type { Automation } from "@/lib/supabase/database.types";

// Each due automation plans + (if trusted) executes a full workflow via Claude.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Cap work per sweep so a backlog (or a misconfigured schedule) can't run away
// with the Anthropic budget; the next sweep picks up the remainder.
const MAX_PER_SWEEP = 10;

/**
 * GET /api/cron — the scheduled sweep (wired via vercel.json crons). Finds
 * schedule automations that are due, fires each, and advances next_run_at.
 *
 * Runs without a user session, so it uses the service-role client and scopes
 * every run to the automation's own organization. Protected by CRON_SECRET:
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
 */
export async function GET(request: Request) {
  // Require the secret — never run the sweep open, or any caller could trigger
  // (paid) workflow runs. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — scheduled runs are disabled" },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Scheduled runs require SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const now = new Date();

  const { data, error } = await supabase
    .from("automations")
    .select("*")
    .eq("enabled", true)
    .eq("trigger_type", "schedule")
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_SWEEP);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = (data ?? []) as Automation[];
  const results: { id: string; status: string }[] = [];

  // Known limitations (acceptable at hourly cadence + MAX_PER_SWEEP, revisit if
  // cadence tightens): run_count is a read-then-write increment, and two
  // overlapping sweeps could both select the same row. A future hardening is an
  // atomic `UPDATE … RETURNING` claim (or a DB increment fn) to make this safe
  // under concurrency.

  for (const a of due) {
    if (!a.created_by) {
      results.push({ id: a.id, status: "skipped: no owner" });
      continue;
    }
    let status = "ok";
    try {
      await runAutomation(
        { supabase, orgId: a.organization_id, actorId: a.created_by },
        { id: a.id, prompt: a.prompt, auto_approve: a.auto_approve },
      );
    } catch (e) {
      status = `failed: ${e instanceof Error ? e.message : "unknown"}`;
    }

    await supabase
      .from("automations")
      .update({
        last_run_at: now.toISOString(),
        last_run_status: status,
        run_count: a.run_count + 1,
        next_run_at: a.schedule ? nextRun(a.schedule, now)?.toISOString() ?? null : null,
      })
      .eq("id", a.id);

    results.push({ id: a.id, status });
  }

  // Best-effort SLA auto-escalation: raise tracked team tasks for workflows
  // stuck past their SLA so nothing depends on someone watching the grid.
  // Defensive — runSlaEscalations never throws, but wrap anyway so it can never
  // break or block the automation sweep above.
  let escalated = 0;
  try {
    escalated = await runSlaEscalations(supabase, now);
  } catch {
    escalated = 0;
  }

  return NextResponse.json({ swept: due.length, results, escalated });
}
