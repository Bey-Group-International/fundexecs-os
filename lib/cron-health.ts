// lib/cron-health.ts
// Last-run tracking + health derivation for the scheduled pipeline.
//
// Three cron entrypoints drive the loop: /api/cron (hourly), /api/digest
// (daily), /api/digest/weekly (weekly). Each appends one row to public.cron_runs
// at the end of its run via recordCronRun (best-effort, never throws), so the
// read-only health surface can show last-run-per-job + a staleness flag.
//
// The staleness math lives in the pure, tested helper isStale; loadCronHealth
// composes the latest-run-per-job reduction with that flag.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CronRun, Database, Json } from "@/lib/supabase/database.types";

// The cron jobs we track, keyed by the value written to cron_runs.job.
export type CronJob = "cron" | "digest" | "digest_weekly";

// All tracked jobs, in display order (hourly → daily → weekly).
export const CRON_JOBS: CronJob[] = ["cron", "digest", "digest_weekly"];

// Human labels for each job, for the health surface.
export const CRON_JOB_LABELS: Record<CronJob, string> = {
  cron: "Hourly sweep",
  digest: "Daily digest",
  digest_weekly: "Weekly rollup",
};

// How long a job may go between runs before it's considered stale. Each cadence
// gets a grace window past its nominal period so a single slightly-late run
// doesn't flap the badge: hourly → 2h, daily → 26h, weekly → 8d.
export const MAX_AGE_HOURS_BY_JOB: Record<CronJob, number> = {
  cron: 2,
  digest: 26,
  digest_weekly: 8 * 24,
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * Pure staleness check: is a run finished at `finishedAtIso` stale as of `now`,
 * given the per-job max-age window (in hours)? A missing/unparseable timestamp
 * is treated as stale (we've never seen the job run, or the value is garbage).
 */
export function isStale(
  finishedAtIso: string | null | undefined,
  now: Date,
  maxAgeHours: number,
): boolean {
  if (!finishedAtIso) return true;
  const finished = Date.parse(finishedAtIso);
  if (Number.isNaN(finished)) return true;
  return now.getTime() - finished > maxAgeHours * HOUR_MS;
}

// One job's health: its latest run (if any) + the derived staleness flag.
export type CronJobHealth = {
  job: CronJob;
  label: string;
  latest: CronRun | null;
  stale: boolean;
  maxAgeHours: number;
};

/**
 * Reduce a flat list of cron_runs rows to the latest run per tracked job. Pure +
 * order-independent: keeps the row with the newest finished_at for each job.
 */
export function latestRunPerJob(
  runs: Pick<CronRun, "job" | "finished_at">[] | CronRun[],
): Record<string, CronRun> {
  const latest: Record<string, CronRun> = {};
  for (const run of runs as CronRun[]) {
    const prev = latest[run.job];
    if (!prev || Date.parse(run.finished_at) > Date.parse(prev.finished_at)) {
      latest[run.job] = run;
    }
  }
  return latest;
}

/**
 * Derive per-job health (latest run + stale flag) for all tracked jobs, given
 * the latest-run map and the current time. Pure — separated from the DB read so
 * it's directly testable.
 */
export function deriveCronHealth(
  latestByJob: Record<string, CronRun>,
  now: Date,
): CronJobHealth[] {
  return CRON_JOBS.map((job) => {
    const latest = latestByJob[job] ?? null;
    const maxAgeHours = MAX_AGE_HOURS_BY_JOB[job];
    return {
      job,
      label: CRON_JOB_LABELS[job],
      latest,
      stale: isStale(latest?.finished_at, now, maxAgeHours),
      maxAgeHours,
    };
  });
}

// Best-effort recording: a service-role write of a single cron_runs row.
export type RecordCronRunInput = {
  job: CronJob;
  status: "ok" | "error";
  detail?: Record<string, unknown> | null;
  startedAt?: Date | string | null;
};

/**
 * Append one cron_runs row for a completed run. Session-less (service-role) and
 * BEST-EFFORT: it never throws and swallows any error, so health recording can
 * never change a cron route's response shape or break its sweep.
 */
export async function recordCronRun(
  serviceClient: SupabaseClient<Database>,
  input: RecordCronRunInput,
): Promise<void> {
  try {
    const startedAt =
      input.startedAt instanceof Date
        ? input.startedAt.toISOString()
        : input.startedAt ?? null;
    await serviceClient.from("cron_runs").insert({
      job: input.job,
      status: input.status,
      detail: (input.detail ?? null) as Json,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  } catch {
    // Append-only telemetry — never let a failed write break or alter the route.
  }
}

/**
 * Load the latest run per tracked job + a derived freshness/staleness flag, for
 * the read-only health surface. Reads through the caller's client (RLS allows any
 * authenticated principal to read this ops table).
 */
export async function loadCronHealth(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<CronJobHealth[]> {
  // Newest-first; a small cap is plenty to find the latest of three jobs.
  const { data } = await supabase
    .from("cron_runs")
    .select("*")
    .order("finished_at", { ascending: false })
    .limit(60);
  const latestByJob = latestRunPerJob((data ?? []) as CronRun[]);
  return deriveCronHealth(latestByJob, now);
}
