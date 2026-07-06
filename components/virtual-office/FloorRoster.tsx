"use client";

import { useState } from "react";
import { ROOMS } from "./types";

export type RosterEntry = { id: string; name: string; roomKey: string | null; self: boolean };

const ROOM_LABEL: Record<string, string> = Object.fromEntries(ROOMS.map((r) => [r.key, r.label]));

/**
 * Live "who's on the floor" roster — you plus any teammates present, each with
 * the room they're standing in. Reuses the existing socket presence; the Invite
 * button copies the floor link so an org teammate (or guest) can join.
 */
export function FloorRoster({ roster }: { roster: RosterEntry[] }) {
  const [copied, setCopied] = useState(false);

  const invite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable — no-op
    }
  };

  return (
    <div
      className="pointer-events-auto absolute left-2 top-2 z-20 w-[176px] rounded-xl border p-2 backdrop-blur-sm"
      style={{
        background: "rgba(10,8,6,0.82)",
        borderColor: "rgba(201,168,76,0.3)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fg-muted">
          On the floor · {roster.length}
        </span>
        <button
          type="button"
          onClick={invite}
          className="rounded-md px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] transition-colors"
          style={{ color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)", background: "rgba(201,168,76,0.08)" }}
        >
          {copied ? "Copied" : "Invite"}
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {roster.map((m) => (
          <li key={m.id} className="flex items-center gap-1.5 text-[11px]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: m.self ? "#22c55e" : "#c9a84c" }}
            />
            <span className="truncate text-fg-primary">{m.name}</span>
            {m.self ? <span className="text-[8px] text-fg-muted">you</span> : null}
            <span className="ml-auto shrink-0 text-[9px] text-fg-muted">
              {m.roomKey ? ROOM_LABEL[m.roomKey] ?? "" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
