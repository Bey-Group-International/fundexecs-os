"use client";

import { useState } from "react";
import { ROOMS } from "./types";
import { officeInviteUrl } from "@/lib/office/floor-link";

export type RosterEntry = {
  id: string;
  name: string;
  roomKey: string | null;
  self: boolean;
  onCall: boolean;
};

const ROOM_LABEL: Record<string, string> = Object.fromEntries(ROOMS.map((r) => [r.key, r.label]));

/**
 * Live "who's on the floor" roster — you plus any teammates present, each with
 * the room they're standing in and whether they're on a call. Reuses the
 * existing socket presence + proximity bubbles; the Invite popover shares the
 * floor link so an org teammate (or guest) can join. No new backend.
 */
export function FloorRoster({ roster }: { roster: RosterEntry[] }) {
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const onCallCount = roster.filter((m) => m.onCall).length;

  // Each room has its own stable invite link — copy the one for the room you're
  // standing in so teammates land right next to you.
  const selfRoom = roster.find((m) => m.self)?.roomKey ?? null;
  const selfRoomLabel = selfRoom ? ROOM_LABEL[selfRoom] ?? null : null;

  const copyLink = async () => {
    try {
      const url =
        typeof window !== "undefined"
          ? officeInviteUrl(window.location.origin, { room: selfRoom })
          : "";
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable — no-op
    }
  };

  return (
    <div
      className="pointer-events-auto absolute left-2 top-2 z-20 w-[188px] rounded-xl border p-2 backdrop-blur-sm"
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
          onClick={() => setInviteOpen((v) => !v)}
          aria-expanded={inviteOpen}
          className="rounded-md px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] transition-colors"
          style={{ color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)", background: "rgba(201,168,76,0.08)" }}
        >
          Invite
        </button>
      </div>

      {inviteOpen ? (
        <div
          className="mb-2 rounded-lg border p-2"
          style={{ borderColor: "rgba(201,168,76,0.22)", background: "rgba(201,168,76,0.05)" }}
        >
          <p className="mb-1.5 text-[10px] leading-snug text-fg-muted">
            {selfRoomLabel
              ? `Share this link to ${selfRoomLabel}. Teammates in your org land in the room; anyone else joins as a guest.`
              : "Share this floor link. Teammates in your org join instantly; anyone else joins as a guest."}
          </p>
          <button
            type="button"
            onClick={copyLink}
            className="w-full rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors"
            style={{ color: "#0a0806", background: "#c9a84c" }}
          >
            {copied ? "Link copied ✓" : selfRoomLabel ? `Copy ${selfRoomLabel} link` : "Copy floor link"}
          </button>
        </div>
      ) : null}

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
            {m.onCall ? (
              <span
                aria-label="on a call"
                title="On a call"
                className="shrink-0 text-[9px]"
                style={{ color: "#7dd3fc" }}
              >
                ●
              </span>
            ) : null}
            <span className="ml-auto shrink-0 text-[9px] text-fg-muted">
              {m.roomKey ? ROOM_LABEL[m.roomKey] ?? "" : ""}
            </span>
          </li>
        ))}
      </ul>

      {onCallCount > 0 ? (
        <p className="mt-1.5 font-mono text-[8px] uppercase tracking-[0.14em]" style={{ color: "#7dd3fc" }}>
          {onCallCount} on a call
        </p>
      ) : null}
    </div>
  );
}
