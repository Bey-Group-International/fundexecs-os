"use client";

import { useEffect, useState } from "react";
import { FLOOR_ACTIVITY_META, relativeTime, type FloorEvent } from "@/lib/office/floor-activity";

const GOLD = "#c9a84c";

/**
 * In-world activity ticker + presence, pinned bottom-left of the floor. Shows a
 * live "who's on the floor" count and a rolling feed of real floor moments
 * (Earn routing work, meetings, deal rooms, new listings, people joining) that
 * the rest of the office announces via emitFloorActivity. Collapsible so it
 * never crowds the canvas.
 */
export function FloorActivityFeed({
  events,
  presenceCount,
}: {
  events: FloorEvent[];
  presenceCount: number;
}) {
  const [open, setOpen] = useState(true);
  // Re-render periodically so relative timestamps stay fresh without a prop churn.
  const [now, setNow] = useState(() => events[0]?.ts ?? 0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [events]);

  const recent = events.slice(0, 6);

  return (
    <div
      className="pointer-events-auto absolute bottom-2 left-2 z-20 w-[212px] rounded-xl border p-2 backdrop-blur-sm"
      style={{ borderColor: `${GOLD}30`, background: "rgba(10,8,6,0.9)" }}
    >
      {/* Header: presence + collapse toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "#22c55e" }} aria-hidden />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD }}>
            {presenceCount} on the floor
          </span>
        </span>
        <span className="font-mono text-[10px] text-slate-500">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {recent.length === 0 ? (
            <li className="px-0.5 py-1 text-[10px] leading-snug text-slate-600">
              Quiet on the floor. Actions show up here as they happen.
            </li>
          ) : (
            recent.map((e) => {
              const meta = FLOOR_ACTIVITY_META[e.kind];
              return (
                <li key={e.id} className="flex items-start gap-1.5">
                  <span
                    className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: meta.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-[10px] leading-snug text-slate-300">{e.text}</span>
                  <span className="shrink-0 font-mono text-[9px] text-slate-600">{relativeTime(e.ts, now)}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
