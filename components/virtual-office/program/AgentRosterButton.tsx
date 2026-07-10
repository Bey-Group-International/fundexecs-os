"use client";

// Top-rail "Team" control — a roster popover of every executive on the floor
// with a live status dot and what they own right now. Selecting one opens the
// AgentFloorInspector for that executive (the same panel you get by walking up
// to them and pressing T). This is the top-rail entry point the floor pairs
// with the walk-up proximity trigger.
import { useEffect, useRef, useState } from "react";
import { PROGRAM_AGENTS, type AgentId, type AgentState } from "./officeProgram";
import { useOfficeProgram } from "./useOfficeProgram";

const STATUS_DOT: Record<AgentState, string> = {
  idle: "#64748b",
  listening: "#fbbf24",
  classifying: "#fbbf24",
  assigned: "#c9a84c",
  moving: "#c9a84c",
  working: "#38bdf8",
  collaborating: "#38bdf8",
  reviewing: "#a855f7",
  waiting_for_approval: "#f59e0b",
  complete: "#22c55e",
  blocked: "#ef4444",
};

export function AgentRosterButton({ onInspect }: { onInspect: (id: AgentId) => void }) {
  const s = useOfficeProgram();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = PROGRAM_AGENTS.filter((a) => (s.agents[a.id]?.state ?? "idle") !== "idle").length;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Inspect the executive team"
        className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] transition-all duration-150"
        style={{
          fontFamily: "Georgia, serif",
          letterSpacing: "0.06em",
          color: open ? "#c9a84c" : "#94a3b8",
          background: open ? "rgba(201,168,76,0.12)" : "transparent",
          border: `1px solid ${open ? "rgba(201,168,76,0.35)" : "rgba(255,255,255,0.05)"}`,
        }}
      >
        <span className="opacity-60 text-[8px]">☰</span>
        Team
        {active > 0 && (
          <span
            className="ml-0.5 text-[8px]"
            style={{ color: "#22c55e" }}
            title={`${active} active`}
          >
            {active}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-lg"
          style={{
            background: "linear-gradient(180deg, rgba(12,10,7,0.97) 0%, rgba(8,6,4,0.98) 100%)",
            border: "1px solid rgba(201,168,76,0.35)",
            boxShadow: "0 16px 44px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{ fontFamily: "Georgia,serif", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(201,168,76,0.7)" }}
            className="px-3 pt-2.5 pb-1.5"
          >
            Executive team
          </div>
          <div className="max-h-[320px] overflow-y-auto pb-1.5">
            {PROGRAM_AGENTS.map((a) => {
              const rt = s.agents[a.id];
              const state = rt?.state ?? "idle";
              return (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onInspect(a.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <span
                    className="shrink-0 rounded-full"
                    style={{ width: 7, height: 7, background: STATUS_DOT[state], boxShadow: `0 0 6px ${STATUS_DOT[state]}88` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px]" style={{ color: "rgba(255,248,220,0.9)" }}>
                      {a.name}
                    </span>
                    <span className="block truncate text-[8.5px]" style={{ color: "rgba(255,248,220,0.4)" }}>
                      {rt?.owns ?? a.role}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
