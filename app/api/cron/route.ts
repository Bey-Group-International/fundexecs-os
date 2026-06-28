import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/server";
import { runAutomation } from "@/lib/engine";
import { nextRun } from "@/lib/cron";
import { findDueOrgsForScan, scanOrgRadarSignals } from "@/lib/radar-scan";
import { runSlaEscalations } from "@/lib/sla-cron";
import { recordCronRun } from "@/lib/cron-health";
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
      Sentry.captureException(e, { tags: { automationId: a.id, orgId: a.organization_id } });
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

  // ---------------------------------------------------------------------------
  // Radar signal scan (push, not pull) — self-contained, append-only block.
  //
  // Today the radar's "why now" half only fills in when an operator manually
  // triggers a scan. Here the hourly sweep tops it up automatically: pick the
  // orgs whose freshest signal is stale (>24h, or never scanned), scoped per
  // org via the service-role client, capped at MAX_ORGS_PER_SWEEP so the signal
  // budget can't run away (mirrors MAX_PER_SWEEP above). The once-per-day
  // staleness guard means a given org is rescanned at most daily even though the
  // cron fires hourly. Best-effort: a failure here never aborts the automations
  // sweep that already ran, and reuses /api/cron (no new cron path / vercel.json
  // change). Org selection + staleness live in lib/radar-scan.ts (pure + tested).
  const radar: { scannedOrgs: number; generated: number; entities: number } = {
    scannedOrgs: 0,
    generated: 0,
    entities: 0,
  };
  try {
    const dueOrgs = await findDueOrgsForScan(supabase, now);
    radar.scannedOrgs = dueOrgs.length;
    for (const orgId of dueOrgs) {
      try {
        const r = await scanOrgRadarSignals(supabase, orgId);
        radar.generated += r.generated;
        radar.entities += r.scanned;
      } catch (e) {
        Sentry.captureException(e, { tags: { orgId, job: "radar_scan" } });
      }
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { job: "radar_scan_outer" } });
  }

  // Best-effort SLA auto-escalation: raise tracked team tasks for workflows
  // stuck past their SLA so nothing depends on someone watching the grid.
  // Defensive — runSlaEscalations never throws, but wrap anyway so it can never
  // break or block the automation sweep above.
  let escalated = 0;
  try {
    escalated = await runSlaEscalations(supabase, now);
  } catch (e) {
    Sentry.captureException(e, { tags: { job: "sla_escalation" } });
    escalated = 0;
  }

  // Last-run tracking (append-only, best-effort): record that the hourly sweep
  // ran so the pipeline's liveness is observable. Never throws; never changes the
  // response below.
  await recordCronRun(supabase, {
    job: "cron",
    status: "ok",
    detail: {
      swept: due.length,
      scannedOrgs: radar.scannedOrgs,
      generated: radar.generated,
      escalated,
    },
    startedAt: now,
  });

  return NextResponse.json({ swept: due.length, results, radar, escalated });
}
