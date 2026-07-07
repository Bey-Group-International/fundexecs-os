"use client";

import { useEffect, useState } from "react";
import { FLOOR_ACTIVITY_META, relativeTime, type FloorEvent } from "@/lib/office/floor-activity";

const GOLD = "#c9a84c";

/**
 * Top-rail presence chip + activity dropdown. Shows a compact live "N on the
 * floor" count inline in the office toolbar; clicking it drops down the rolling
 * feed of real floor moments (Earn routing work, meetings, deal rooms, new
 * listings, people joining) that the office announces via emitFloorActivity.
 */
export function FloorActivityFeed({
  events,
  presenceCount,
}: {
  events: FloorEvent[];
  presenceCount: number;
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

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Floor activity"
        className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] transition-all duration-150"
        style={{
          fontFamily: "Georgia, serif",
          letterSpacing: "0.04em",
          color: "#cbd2dc",
          background: open ? "rgba(201,168,76,0.1)" : "transparent",
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "#22c55e" }} aria-hidden />
        {presenceCount} on the floor
        <span className="text-[8px] opacity-70">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-40 mt-1 w-[248px] rounded-xl border p-2 backdrop-blur-sm"
            style={{ borderColor: `${GOLD}30`, background: "rgba(10,8,6,0.95)" }}
          >
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">Floor activity</p>
            <ul className="flex max-h-[240px] flex-col gap-1 overflow-y-auto">
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
          </div>
        </>
      )}
    </div>
  );
}
