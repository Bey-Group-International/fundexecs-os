"use client";

import { useEffect, useRef, useState } from "react";
import { loadCronHealthAction } from "@/app/(app)/[hub]/[module]/health-actions";
import type { CronJobHealth } from "@/lib/cron-health";

type Phase = "idle" | "loading" | "done";

// Client-safe relative-time formatter. Inlined (rather than imported from
// lib/activity) because that module pulls in the server-only Supabase client
// (next/headers), which can't be bundled into this "use client" component.
function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = now.getTime() - then;
  if (diff < 0) return "just now";

  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Scheduling Health — a read-only view of the scheduled pipeline's liveness. The
// loop runs on three cron entrypoints (hourly sweep, daily digest, weekly
// rollup); each appends a row to cron_runs at the end of its run. This surfaces
// the last run per job with relative time + a stale badge when a job has gone too
// long between runs. Read-only: it counts existing data, it writes nothing.
export function CronHealth({ live }: { live?: boolean; initialPrompt?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [health, setHealth] = useState<CronJobHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  async function refresh() {
    setPhase("loading");
    setError(null);
    try {
      const res = await loadCronHealthAction();
      if (!res.ok || !res.health) {
        setError(res.error ?? "Could not load scheduling health.");
        setPhase("idle");
        return;
      }
      setHealth(res.health);
      setPhase("done");
    } catch {
      setError("Could not load scheduling health.");
      setPhase("idle");
    }
  }

  useEffect(() => {
    if (!ranInitial.current) {
      ranInitial.current = true;
      refresh();
    }
     
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Scheduling Health
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              local mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          The scheduled pipeline, end-to-end — the hourly sweep, the daily digest,
          and the weekly rollup. Each records its last run here, so you can see at a
          glance whether the loop is actually running.
        </p>
      </header>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {phase === "done" && health ? (
        <div className="space-y-2">
          {health.map((j) => (
            <JobRow key={j.job} job={j} />
          ))}
          <p className="text-[11px] text-fg-muted">
            Read-only over the cron-run ledger. A job is flagged stale when it has
            gone longer than its expected cadence (with grace) without a recorded
            run — hourly &gt; 2h, daily &gt; 26h, weekly &gt; 8d.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-sm text-fg-muted">Loading scheduling health…</p>
      )}
    </div>
  );
}

// One job's row: label, status, last-run relative time, and a stale/ok badge.
function JobRow({ job }: { job: CronJobHealth }) {
  const last = job.latest?.finished_at ?? null;
  const failed = job.latest?.status === "error";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3">
      <div className="min-w-0">
        <div className="font-mono text-sm font-medium text-fg-primary">{job.label}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          {last ? `Last run ${relativeTime(last)}` : "Never run"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {failed ? (
          <span className="rounded-full border border-status-danger/40 bg-status-danger/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-danger">
            error
          </span>
        ) : null}
        {job.stale ? (
          <span className="rounded-full border border-status-warning/40 bg-status-warning/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-warning">
            stale
          </span>
        ) : (
          <span className="rounded-full border border-status-success/40 bg-status-success/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
            fresh
          </span>
        )}
      </div>
    </div>
  );
}
