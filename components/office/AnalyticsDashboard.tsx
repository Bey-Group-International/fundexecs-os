"use client";

// Team presence & collaboration analytics for the Virtual Office.
//
// Renders an aggregate AnalyticsSummary (stat tiles, per-room usage bars, and a
// collaboration list) alongside the current member's per-member OPT-IN toggle.
// The office only records a member's presence while they have opted in, so the
// toggle is the privacy control for this whole feature.
import { useEffect, useId, useState, useTransition } from "react";
import { ROOM_BY_KEY } from "@/lib/office/layout";
import {
  getMyAnalyticsPref,
  setMyAnalyticsPref,
} from "@/lib/office/analyticsServer";
import type { AnalyticsSummary } from "@/lib/office/analytics";

interface AnalyticsDashboardProps {
  summary: AnalyticsSummary;
  orgId: string;
  /** The member's opt-in flag, resolved server-side for the first paint. */
  initialOptIn: boolean;
  /** Optional friendly names for principal ids; falls back to a short id. */
  memberNames?: Record<string, string>;
}

/** Human label for a room key, from the built-in map or the key itself. */
function roomLabel(key: string): string {
  return ROOM_BY_KEY[key]?.label ?? key;
}

/** Accent color for a room key, from the built-in map or a gold default. */
function roomAccent(key: string): string {
  return ROOM_BY_KEY[key]?.accent ?? "#d4a82a";
}

/** A short, readable stand-in when we have no display name for a member. */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function AnalyticsDashboard({
  summary,
  orgId,
  initialOptIn,
  memberNames = {},
}: AnalyticsDashboardProps) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const [pending, startTransition] = useTransition();
  const switchId = useId();
  const descId = useId();

  // Reconcile with the authoritative server value on mount, in case the first
  // paint used a stale/default flag.
  useEffect(() => {
    let active = true;
    getMyAnalyticsPref(orgId)
      .then((value) => {
        if (active) setOptIn(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [orgId]);

  const toggle = () => {
    const next = !optIn;
    setOptIn(next); // optimistic
    startTransition(async () => {
      const result = await setMyAnalyticsPref(orgId, next);
      setOptIn(result.optIn);
    });
  };

  const name = (id: string) => memberNames[id] ?? shortId(id);

  const rooms = Object.entries(summary.perRoomMinutes)
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxRoomMinutes = rooms.reduce((max, [, m]) => Math.max(max, m), 0);
  const presenceHours = (summary.totalPresenceMinutes / 60).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Opt-in toggle — the privacy control for the whole feature. */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-1 p-4">
        <div className="max-w-prose">
          <p
            id={`${switchId}-label`}
            className="text-sm font-medium text-fg-primary"
          >
            Share my presence in team analytics
          </p>
          <p id={descId} className="mt-1 text-xs text-fg-muted">
            When on, your join/leave and room activity are counted in the
            aggregate metrics below. When off, nothing about you is recorded.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={optIn}
          aria-labelledby={`${switchId}-label`}
          aria-describedby={descId}
          disabled={pending}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 disabled:opacity-60 ${
            optIn ? "bg-gold-500" : "bg-surface-3"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              optIn ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {/* Stat tiles. */}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Active members" value={String(summary.activeMembers)} />
        <StatTile label="Presence hours" value={presenceHours} />
        <StatTile
          label="Busiest room"
          value={summary.busiestRoom ? roomLabel(summary.busiestRoom) : "—"}
        />
      </dl>

      {/* Per-room usage bars. */}
      <section
        aria-labelledby={`${switchId}-rooms`}
        className="rounded-xl border border-border bg-surface-1 p-4"
      >
        <h2
          id={`${switchId}-rooms`}
          className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400"
        >
          Room usage
        </h2>
        {rooms.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">No room activity yet.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {rooms.map(([key, minutes]) => {
              const pct =
                maxRoomMinutes > 0 ? (minutes / maxRoomMinutes) * 100 : 0;
              return (
                <li key={key} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm text-fg-secondary">
                    {roomLabel(key)}
                  </span>
                  <div
                    className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-3"
                    role="img"
                    aria-label={`${roomLabel(key)}: ${minutes} member-minutes`}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(pct, 2)}%`,
                        backgroundColor: roomAccent(key),
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">
                    {minutes}m
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Collaboration list. */}
      <section
        aria-labelledby={`${switchId}-collab`}
        className="rounded-xl border border-border bg-surface-1 p-4"
      >
        <h2
          id={`${switchId}-collab`}
          className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400"
        >
          Collaboration
        </h2>
        {summary.collaborationPairs.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">
            No overlapping room time recorded yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {summary.collaborationPairs.map((pair) => (
              <li
                key={`${pair.a}-${pair.b}`}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="truncate text-fg-secondary">
                  {name(pair.a)} <span className="text-fg-muted">·</span>{" "}
                  {name(pair.b)}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-fg-muted">
                  {pair.minutes}m together
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        {label}
      </dt>
      <dd className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-fg-primary">
        {value}
      </dd>
    </div>
  );
}
