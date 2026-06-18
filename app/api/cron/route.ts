import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runAutomation } from "@/lib/engine";
import { nextRun } from "@/lib/cron";
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
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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

  return NextResponse.json({ swept: due.length, results });
}
