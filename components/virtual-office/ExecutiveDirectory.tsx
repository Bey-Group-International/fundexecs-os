"use client";

import { useMemo, useState } from "react";
import { AvatarPreview } from "./avatar/AvatarPreview";
import { agentAvatarSpec } from "./avatar/avatarPalette";
import { PROGRAM_AGENTS } from "./program/officeProgram";
import { ROOMS } from "./types";

const ROOM_LABEL: Record<string, string> = Object.fromEntries(ROOMS.map((r) => [r.key, r.label]));

/**
 * An in-floor workflow tool: the Executive Directory. Lists every AI executive
 * with their role and home room, and jumps the player straight to them. Reuses
 * the program roster + the existing room teleport — no backend, no navigation
 * away from the floor.
 */
export function ExecutiveDirectory({
  onTeleport,
  onClose,
}: {
  onTeleport: (roomKey: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PROGRAM_AGENTS;
    return PROGRAM_AGENTS.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        (ROOM_LABEL[a.homeRoom] ?? "").toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <>
      <div className="absolute inset-0 z-30" onClick={onClose} />
      <div
        className="pointer-events-auto absolute left-1/2 top-1/2 z-40 w-[320px] max-w-[92%] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border shadow-xl backdrop-blur-sm"
        style={{
          background: "rgba(10,8,6,0.94)",
          borderColor: "rgba(201,168,76,0.35)",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid rgba(201,168,76,0.18)" }}>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: "#c9a84c" }}>
            Executive Directory
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close directory"
            className="text-fg-muted transition-colors hover:text-fg-primary"
          >
            ✕
          </button>
        </div>

        <div className="px-3 pt-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, role, or room…"
            className="w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-[12px] text-fg-primary outline-none"
            style={{ borderColor: "rgba(201,168,76,0.25)" }}
          />
        </div>

        <ul className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto p-2">
          {results.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onTeleport(a.homeRoom)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#c9a84c14]"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md" style={{ background: "#0a0806" }}>
                  <AvatarPreview spec={agentAvatarSpec(a.id, a.accent)} size={30} />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-[13px] font-semibold text-fg-primary">{a.name}</span>
                  <span className="truncate text-[10px] text-fg-muted">{a.role}</span>
                </span>
                <span className="ml-auto flex shrink-0 flex-col items-end leading-tight">
                  <span className="text-[9px]" style={{ color: a.accent }}>
                    {ROOM_LABEL[a.homeRoom] ?? ""}
                  </span>
                  <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-fg-muted">Go →</span>
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="px-2 py-3 text-center text-[11px] text-fg-muted">No executives match “{query}”.</li>
          ) : null}
        </ul>
      </div>
    </>
  );
}
