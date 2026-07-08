"use client";

import { useEffect, useState } from "react";
import { FLOOR_ACTIVITY_META, relativeTime, type FloorEvent } from "@/lib/office/floor-activity";
import { ROOMS } from "../types";
import { statusMeta, type PresenceStatus } from "@/lib/office/presenceStatus";
import type { RosterEntry } from "../VirtualOfficeGame";

const GOLD = "#c9a84c";
const ROOM_LABEL: Record<string, string> = Object.fromEntries(ROOMS.map((r) => [r.key, r.label]));

/**
 * Top-rail presence control — a single "N on the floor" chip that unifies
 * everything about who's here: the operator's own availability (tap to cycle),
 * the roster of teammates with their room + a Follow button, and the rolling
 * feed of real floor moments (Earn routing work, meetings, deal rooms, new
 * listings, joins). Replaces the old split presence-chip + roster-pill.
 */
export function FloorActivityFeed({
  events,
  presenceCount,
  roster,
  status,
  onCycleStatus,
  onFollow,
}: {
  events: FloorEvent[];
  presenceCount: number;
  roster: RosterEntry[];
  status: PresenceStatus;
  onCycleStatus: () => void;
  onFollow: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Refresh relative timestamps while the dropdown is open.
  const [now, setNow] = useState(() => events[0]?.ts ?? 0);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [open, events]);

  const recent = events.slice(0, 8);
  const others = roster.filter((r) => !r.self);
  const meta = statusMeta(status);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Who's on the floor · your availability · activity"
        className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] transition-all duration-150"
        style={{
          fontFamily: "Georgia, serif",
          letterSpacing: "0.04em",
          color: "#cbd2dc",
          background: open ? "rgba(201,168,76,0.1)" : "transparent",
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: meta.dot }} aria-hidden />
        {presenceCount} on the floor
        <span className="text-[8px] opacity-70">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-40 mt-1 w-[252px] rounded-xl border p-2 backdrop-blur-sm"
            style={{ borderColor: `${GOLD}30`, background: "rgba(10,8,6,0.95)" }}
          >
            {/* Self availability — tap to advance Available → Focused → DND → Away */}
            <button
              type="button"
              onClick={onCycleStatus}
              className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.dot }} />
              <span className="text-[11px] text-slate-100">You — {meta.label}</span>
              <span className="ml-auto text-[9px] uppercase tracking-[0.1em] text-slate-500">tap to change</span>
            </button>

            {/* Roster — teammates on the floor, each with room + Follow */}
            {others.length > 0 && (
              <ul className="mb-2 max-h-[168px] space-y-0.5 overflow-y-auto">
                {others.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-md px-2 py-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: r.onCall ? "#38bdf8" : "#64748b" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
                      {r.name}
                      <span className="text-slate-500">
                        {" · "}
                        {r.roomKey ? ROOM_LABEL[r.roomKey] ?? "—" : "—"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onFollow(r.id);
                        setOpen(false);
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors"
                      style={{ color: "#0a0806", background: GOLD, fontFamily: "Georgia, serif" }}
                    >
                      Follow
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">Floor activity</p>
            <ul className="flex max-h-[200px] flex-col gap-1 overflow-y-auto">
              {recent.length === 0 ? (
                <li className="px-0.5 py-1 text-[10px] leading-snug text-slate-600">
                  Quiet on the floor. Actions show up here as they happen.
                </li>
              ) : (
                recent.map((e) => {
                  const m = FLOOR_ACTIVITY_META[e.kind];
                  return (
                    <li key={e.id} className="flex items-start gap-1.5">
                      <span
                        className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: m.color }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 text-[10px] leading-snug text-slate-300">{e.text}</span>
                      <span className="shrink-0 font-mono text-[9px] text-slate-600">{relativeTime(e.ts, now)}</span>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
