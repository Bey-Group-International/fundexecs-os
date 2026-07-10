"use client";

// components/source/SourceLiveHeader.tsx
// The institutional module header shared across the Source hub. It frames each
// pipeline the way a desk expects — title, mandate-aware subtitle, and a live
// KPI strip — and keeps the underlying server-rendered directory near-real-time
// by refreshing the route on an interval. The operator stays in control: Live
// can be paused, refreshes only fire while the tab is visible, and an "as of"
// stamp makes the data's freshness explicit rather than implied.

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_INTERVAL_MS = 30_000;

export interface SourceStat {
  label: string;
  /** Pre-formatted display value (e.g. "128", "$4.2M", "3d ago", "—"). */
  value: string | number;
  hint?: string;
  /** Optional accent class for the value (e.g. "text-emerald-300"). */
  accent?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  stats?: SourceStat[];
  /** Auto-refresh cadence in ms. Defaults to 30s. */
  intervalMs?: number;
}

function relativeSince(ms: number): string {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export function SourceLiveHeader({ title, subtitle, stats = [], intervalMs = DEFAULT_INTERVAL_MS }: Props) {
  const router = useRouter();
  const [live, setLive] = useState(true);
  const [pending, startTransition] = useTransition();
  // Anchored on mount; refreshed on every successful revalidation so the "as of"
  // stamp reflects the data actually on screen, not the last render of the page.
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const liveRef = useRef(live);
  liveRef.current = live;

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setSyncedAt(Date.now());
    });
  }, [router]);

  // Auto-refresh loop — only while Live and the tab is visible, so a backgrounded
  // desk doesn't hammer the server or drift the "as of" stamp.
  useEffect(() => {
    setSyncedAt(Date.now());
    const id = setInterval(() => {
      if (liveRef.current && document.visibilityState === "visible") {
        startTransition(() => {
          router.refresh();
          setSyncedAt(Date.now());
        });
      }
    }, intervalMs);
    const onVisible = () => {
      if (liveRef.current && document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, refresh, router]);

  // Re-render the relative stamp every second without touching the server.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold text-fg-primary">{title}</h2>
          {subtitle ? <p className="mt-1 max-w-2xl text-sm text-fg-secondary">{subtitle}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            aria-pressed={live}
            title={live ? "Live — auto-refreshing. Click to pause." : "Paused. Click to resume live updates."}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
              live
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-line bg-surface-2 text-fg-muted hover:text-fg-primary"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {live ? (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              ) : null}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-400" : "bg-fg-muted/60"}`}
              />
            </span>
            {live ? "Live" : "Paused"}
          </button>

          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="fx-focus rounded-md border border-line p-1.5 text-fg-muted transition hover:text-fg-primary disabled:opacity-50"
            title="Refresh now"
            aria-label="Refresh now"
          >
            <svg
              className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
            </svg>
          </button>
        </div>
      </div>

      {stats.length ? (
        <div
          className={`mt-4 grid grid-cols-2 gap-2 ${
            stats.length <= 2 ? "sm:grid-cols-2" : stats.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4"
          }`}
        >
          {stats.map((s) => (
            <div key={s.label} className="fx-stat">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">{s.label}</p>
              <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${s.accent ?? "text-fg-primary"}`}>
                {s.value}
              </p>
              {s.hint ? <p className="mt-0.5 text-[11px] text-fg-muted">{s.hint}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted/70">
        {syncedAt ? `As of ${relativeSince(syncedAt)}` : "Syncing…"}
        {live ? " · streaming" : " · paused"}
      </p>
    </header>
  );
}
