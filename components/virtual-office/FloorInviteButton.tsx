"use client";

import { useState } from "react";
import { ROOMS } from "./types";
import { officeInviteUrl } from "@/lib/office/floor-link";

const GOLD = "#c9a84c";
const ROOM_LABEL: Record<string, string> = Object.fromEntries(ROOMS.map((r) => [r.key, r.label]));

/**
 * Top-rail INVITE control. Opens a small popover that copies the stable link to
 * the room the operator is standing in, so a teammate (in-org) or guest lands
 * right next to them. Replaces the old roster panel's invite affordance.
 */
export function FloorInviteButton({ currentRoom }: { currentRoom: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const roomLabel = currentRoom ? ROOM_LABEL[currentRoom] ?? null : null;

  const copyLink = async () => {
    try {
      const url =
        typeof window !== "undefined" ? officeInviteUrl(window.location.origin, { room: currentRoom || null }) : "";
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Invite someone to the floor"
        className="flex items-center gap-1 rounded px-2.5 py-1 text-[10px] transition-all duration-150"
        style={{
          fontFamily: "Georgia, serif",
          letterSpacing: "0.06em",
          color: GOLD,
          background: open ? "rgba(201,168,76,0.12)" : "rgba(201,168,76,0.07)",
          border: `1px solid ${open ? "rgba(201,168,76,0.4)" : "rgba(201,168,76,0.25)"}`,
        }}
      >
        Invite
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full z-40 mt-1 w-[224px] rounded-xl border p-2 backdrop-blur-sm"
            style={{ borderColor: "rgba(201,168,76,0.22)", background: "rgba(10,8,6,0.95)" }}
          >
            <p className="mb-1.5 text-[10px] leading-snug text-slate-400">
              {roomLabel
                ? `Share this link to the ${roomLabel}. Teammates in your org land in the room; anyone else joins as a guest.`
                : "Share this floor link. Teammates in your org join instantly; anyone else joins as a guest."}
            </p>
            <button
              type="button"
              onClick={copyLink}
              className="w-full rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors"
              style={{ color: "#0a0806", background: GOLD, fontFamily: "Georgia, serif" }}
            >
              {copied ? "Link copied ✓" : roomLabel ? `Copy ${roomLabel} link` : "Copy floor link"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
