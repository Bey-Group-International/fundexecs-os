"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { loadCronHealth, type CronJobHealth } from "@/lib/cron-health";

export interface CronHealthResult {
  ok: boolean;
  health?: CronJobHealth[];
  error?: string;
}

// The pipeline-liveness read: last-run-per-job + a derived staleness flag for the
// three scheduled entrypoints (hourly cron, daily digest, weekly rollup). Auth-
// guarded; cron_runs is an org-agnostic ops table readable by any authenticated
// principal, so this just needs a signed-in member. Read-only.
export async function loadCronHealthAction(): Promise<CronHealthResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const health = await loadCronHealth(supabase);
  return { ok: true, health };
}
