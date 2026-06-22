// lib/cron-health.test.ts
// Unit tests for the cron-health derivation — the pure staleness check
// (fresh/stale boundaries per job, missing timestamp → stale) and the
// latest-run-per-job reduction. No DB: every helper is deterministic.
import {
  isStale,
  latestRunPerJob,
  deriveCronHealth,
  MAX_AGE_HOURS_BY_JOB,
  CRON_JOBS,
} from "@/lib/cron-health";
import type { CronRun } from "@/lib/supabase/database.types";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-06-22T12:00:00.000Z");

function run(job: string, finishedAt: string, extra: Partial<CronRun> = {}): CronRun {
  return {
    id: `${job}-${finishedAt}`,
    job,
    status: "ok",
    detail: null,
    started_at: null,
    finished_at: finishedAt,
    ...extra,
  };
}

describe("isStale (pure staleness check)", () => {
  it("treats a missing timestamp as stale", () => {
    expect(isStale(null, NOW, 2)).toBe(true);
    expect(isStale(undefined, NOW, 2)).toBe(true);
  });

  it("treats an unparseable timestamp as stale", () => {
    expect(isStale("not-a-date", NOW, 2)).toBe(true);
  });

  it("is fresh just inside the window and stale just past it", () => {
    const justInside = new Date(NOW.getTime() - (2 * HOUR - 1000)).toISOString();
    const justPast = new Date(NOW.getTime() - (2 * HOUR + 1000)).toISOString();
    expect(isStale(justInside, NOW, 2)).toBe(false);
    expect(isStale(justPast, NOW, 2)).toBe(true);
  });

  it("treats a future timestamp as fresh", () => {
    const future = new Date(NOW.getTime() + HOUR).toISOString();
    expect(isStale(future, NOW, 2)).toBe(false);
  });

  it("applies the per-job windows: hourly 2h, daily 26h, weekly 8d", () => {
    expect(MAX_AGE_HOURS_BY_JOB.cron).toBe(2);
    expect(MAX_AGE_HOURS_BY_JOB.digest).toBe(26);
    expect(MAX_AGE_HOURS_BY_JOB.digest_weekly).toBe(8 * 24);

    // A run 3h old: stale for hourly, fresh for daily.
    const threeHoursAgo = new Date(NOW.getTime() - 3 * HOUR).toISOString();
    expect(isStale(threeHoursAgo, NOW, MAX_AGE_HOURS_BY_JOB.cron)).toBe(true);
    expect(isStale(threeHoursAgo, NOW, MAX_AGE_HOURS_BY_JOB.digest)).toBe(false);

    // A run 27h old: stale for daily, fresh for weekly.
    const day1 = new Date(NOW.getTime() - 27 * HOUR).toISOString();
    expect(isStale(day1, NOW, MAX_AGE_HOURS_BY_JOB.digest)).toBe(true);
    expect(isStale(day1, NOW, MAX_AGE_HOURS_BY_JOB.digest_weekly)).toBe(false);

    // A run 9d old: stale even for weekly.
    const nineDays = new Date(NOW.getTime() - 9 * 24 * HOUR).toISOString();
    expect(isStale(nineDays, NOW, MAX_AGE_HOURS_BY_JOB.digest_weekly)).toBe(true);
  });
});

describe("latestRunPerJob (reduction)", () => {
  it("keeps the newest finished_at per job, order-independently", () => {
    const runs: CronRun[] = [
      run("cron", "2026-06-22T10:00:00.000Z"),
      run("cron", "2026-06-22T11:00:00.000Z"),
      run("cron", "2026-06-22T09:00:00.000Z"),
      run("digest", "2026-06-21T06:00:00.000Z"),
    ];
    const latest = latestRunPerJob(runs);
    expect(latest.cron.finished_at).toBe("2026-06-22T11:00:00.000Z");
    expect(latest.digest.finished_at).toBe("2026-06-21T06:00:00.000Z");
    expect(latest.digest_weekly).toBeUndefined();
  });

  it("returns an empty map for no runs", () => {
    expect(latestRunPerJob([])).toEqual({});
  });
});

describe("deriveCronHealth", () => {
  it("returns one entry per tracked job in order, with stale flags", () => {
    const latest = latestRunPerJob([
      // hourly: 1h ago → fresh
      run("cron", new Date(NOW.getTime() - 1 * HOUR).toISOString()),
      // daily: 30h ago → stale (window 26h)
      run("digest", new Date(NOW.getTime() - 30 * HOUR).toISOString()),
      // weekly: never run
    ]);
    const health = deriveCronHealth(latest, NOW);

    expect(health.map((h) => h.job)).toEqual(CRON_JOBS);

    const cron = health.find((h) => h.job === "cron")!;
    expect(cron.stale).toBe(false);
    expect(cron.latest).not.toBeNull();

    const digest = health.find((h) => h.job === "digest")!;
    expect(digest.stale).toBe(true);

    const weekly = health.find((h) => h.job === "digest_weekly")!;
    expect(weekly.latest).toBeNull();
    expect(weekly.stale).toBe(true); // never run → stale
  });
});
