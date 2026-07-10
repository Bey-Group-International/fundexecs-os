"use client";

// The live network activity feed — a chronological stream of everything moving
// through the operator's relationship graph (market signals, commitments,
// touches, warm intros, meetings, outreach, new prospects). Polls the activity
// endpoint on an interval so the view stays near-real-time without a reload.

import { useCallback, useEffect, useRef, useState } from "react";
import type { NetworkActivityEvent, NetworkLiveCounts, ActivityType } from "@/lib/network-active";

const POLL_MS = 25_000;

const TYPE_META: Record<ActivityType, { icon: React.ReactNode; tone: string }> = {
  signal: { tone: "text-gold-300 bg-gold-500/10", icon: <path d="M3 12h4l3 8 4-16 3 8h4" /> },
  commitment: { tone: "text-emerald-300 bg-emerald-500/10", icon: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
  touch: { tone: "text-accent-300 bg-accent-400/10", icon: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /> },
  intro: { tone: "text-accent-300 bg-accent-400/10", icon: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /> },
  action: { tone: "text-gold-300 bg-gold-500/10", icon: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /> },
  meeting: { tone: "text-fg-secondary bg-surface-2", icon: <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /> },
  outreach: { tone: "text-fg-secondary bg-surface-2", icon: <path d="M4 4h16v16H4zM22 6l-10 7L2 6" /> },
  prospect: { tone: "text-emerald-300 bg-emerald-500/10", icon: <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" /> },
  contact: { tone: "text-fg-secondary bg-surface-2", icon: <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /> },
};

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const mos = Math.round(days / 30);
  if (mos < 12) return `${mos}mo ago`;
  return `${Math.round(mos / 12)}y ago`;
}

interface Props {
  initialEvents: NetworkActivityEvent[];
  initialLive: NetworkLiveCounts;
}

export function NetworkActivityFeed({ initialEvents, initialLive }: Props) {
  const [events, setEvents] = useState(initialEvents);
  const [live, setLive] = useState(initialLive);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const seen = useRef(new Set(initialEvents.map((e) => e.id)));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/network/activity?limit=40", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { events: NetworkActivityEvent[]; live: NetworkLiveCounts };
      if (Array.isArray(data.events)) {
        seen.current = new Set(data.events.map((e) => e.id));
        setEvents(data.events);
      }
      if (data.live) setLive(data.live);
      setUpdatedAt(Date.now());
    } catch {
      /* transient — keep the last good view */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <div className="fx-card flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">Live activity</p>
        </div>
        <button
          onClick={refresh}
          className="fx-focus rounded-md p-1 text-fg-muted transition hover:text-fg-primary"
          title="Refresh now"
          aria-label="Refresh activity"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
        </button>
      </div>

      {/* Live counts */}
      <div className="grid grid-cols-3 divide-x divide-line/60 border-b border-line/70">
        {[
          { label: "Signals · 7d", value: live.signals7d },
          { label: "Touches · 7d", value: live.touches7d },
          { label: "New · 7d", value: live.newThisWeek },
        ].map((s) => (
          <div key={s.label} className="px-3 py-2.5 text-center">
            <p className="font-mono text-lg font-semibold tabular-nums text-fg-primary">{s.value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-fg-muted">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Feed */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted">
            No network activity yet. Signals, touches, and commitments will stream in here.
          </p>
        ) : (
          <ul className="divide-y divide-line/50">
            {events.map((e) => {
              const meta = TYPE_META[e.type] ?? TYPE_META.contact;
              return (
                <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      {meta.icon}
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-fg-primary">{e.title}</p>
                    {e.detail && <p className="mt-0.5 truncate text-xs text-fg-muted">{e.detail}</p>}
                  </div>
                  <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] tabular-nums text-fg-muted/80">
                    {relativeTime(e.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {updatedAt && (
        <div className="border-t border-line/70 px-4 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-fg-muted/70">
            Updated {relativeTime(new Date(updatedAt).toISOString())}
          </p>
        </div>
      )}
    </div>
  );
}
