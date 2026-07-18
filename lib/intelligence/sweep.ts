// lib/intelligence/sweep.ts
// The scheduled intelligence sync — enumerates workspaces with a CONNECTED
// provider and ingests each, mirroring lib/proactive/orchestrate
// runProactiveSweepAllOrgs. Best-effort per org (a failure never aborts the
// batch), gated behind the core flag, capped per sweep to bound cost and respect
// provider rate limits. Slots into the hourly /api/cron sweep exactly like the
// proactive / radar / webhook blocks.

import type { createServiceClient } from "@/lib/supabase/server";
import { coreEnabled } from "./flags";
import { ingestProvider } from "./ingest";

type Db = ReturnType<typeof createServiceClient>;

export interface SweepSummary {
  orgs: number;
  fetched: number;
  persisted: number;
  assessed: number;
}

/**
 * Sweep every workspace that has a connected provider. Only 'connected'
 * connections are candidates, so a disabled/errored provider is skipped without
 * a wasted call. Do not poll more often than the source materially changes — the
 * hourly cadence + per-source freshness TTLs keep this well within feed limits.
 */
export async function runIntelligenceSyncAllOrgs(
  supabase: Db,
  opts: { maxOrgs?: number; providers?: string[] } = {},
): Promise<SweepSummary> {
  const summary: SweepSummary = { orgs: 0, fetched: 0, persisted: 0, assessed: 0 };
  if (!coreEnabled()) return summary;

  const providers = opts.providers ?? ["signal_bureau"];

  const { data } = await (
    supabase as unknown as { from: (t: string) => ReturnType<Db["from"]> }
  )
    .from("intelligence_provider_connections")
    .select("organization_id, provider")
    .eq("status", "connected")
    .in("provider", providers)
    .limit(500);

  const pairs = (data ?? []) as unknown as Array<{ organization_id: string; provider: string }>;
  const capped = pairs.slice(0, opts.maxOrgs ?? 10);

  for (const { organization_id, provider } of capped) {
    try {
      const r = await ingestProvider(organization_id, provider);
      summary.orgs += 1;
      summary.fetched += r.fetched;
      summary.persisted += r.persisted;
      summary.assessed += r.assessed;
    } catch {
      // best-effort per org — never abort the sweep.
    }
  }

  return summary;
}
