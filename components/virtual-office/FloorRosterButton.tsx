"use client";

import { useState } from "react";
import { ROOMS } from "./types";
import { statusMeta, type PresenceStatus } from "@/lib/office/presenceStatus";
import type { RosterEntry } from "./VirtualOfficeGame";

const GOLD = "#c9a84c";
const ROOM_LABEL: Record<string, string> = Object.fromEntries(ROOMS.map((r) => [r.key, r.label]));

/**
 * Top-rail "who's on the floor" control (Spot-style ambient presence). The pill
 * shows the operator's availability dot + a live headcount; the popover lets the
 * operator cycle their own status (Available / Focused / DND / Away) and, for
 * each teammate on the floor, see their room and **Follow** them — the player's
 * avatar then walks over and trails them (mirrors the F-key follow).
 */
export function FloorRosterButton({
  roster,
  status,
  onCycleStatus,
  onFollow,
}: {
  roster: RosterEntry[];
  status: PresenceStatus;
  onCycleStatus: () => void;
  onFollow: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = statusMeta(status);
  const others = roster.filter((r) => !r.self);
  const count = Math.max(roster.length, 1);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Who's on the floor · your availability"
        className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] transition-all duration-150"
        style={{
          fontFamily: "Georgia, serif",
          letterSpacing: "0.06em",
          color: "#cbd5e1",
          background: open ? "rgba(255,255,255,0.08)" : "transparent",
          border: `1px solid ${open ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)"}`,
        }}
      >
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.dot }} />
        {count} on floor
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-40 mt-1 w-[240px] rounded-xl border p-2 backdrop-blur-sm"
            style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(10,8,6,0.96)" }}
          >
            {/* Self status — click to advance Available → Focused → DND → Away */}
            <button
              type="button"
              onClick={onCycleStatus}
              className="mb-1.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: meta.dot }} />
              <span className="text-[11px] text-slate-100">You — {meta.label}</span>
              <span className="ml-auto text-[9px] uppercase tracking-[0.1em] text-slate-500">tap to change</span>
            </button>

            {others.length === 0 ? (
              <p className="px-1 py-1 text-[10px] leading-snug text-slate-500">
                No teammates on the floor yet. Share an invite to fill the room.
              </p>
            ) : (
              <ul className="max-h-[220px] space-y-0.5 overflow-y-auto">
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
                      onClick={() => onFollow(r.id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors"
                      style={{ color: "#0a0806", background: GOLD, fontFamily: "Georgia, serif" }}
                    >
                      Follow
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
