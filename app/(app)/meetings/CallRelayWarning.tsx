"use client";

import { useEffect, useState } from "react";

// The standing warning that some people cannot connect to calls at all.
//
// A browser call goes peer-to-peer when it can. On symmetric NAT, corporate
// firewalls and mobile carrier networks it cannot, and the media has to go
// through a TURN relay. With none configured, a guest on those networks joins,
// opens their camera, and is neither seen nor heard — the room says "Connection
// lost" and nothing says why. Production logs this every time it happens, but
// nobody who can fix it reads the logs.
//
// Shown only to owners and admins, because only they can fix it, and
// dismissible per browser like the mailbox warning: a nudge, not a setting.
const DISMISS_KEY = "fx.meetings.relayWarning.dismissed";

export function CallRelayWarning({ reason }: { reason: "unconfigured" | "misconfigured" }) {
  // Starts hidden and appears after mount, so a dismissed warning never flashes.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const accent = "var(--status-warning)";

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-2xl border bg-surface-1/80 px-4 py-3"
      style={{ borderColor: `color-mix(in srgb, ${accent} 35%, transparent)` }}
    >
      <span
        aria-hidden
        className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-surface-1"
        style={{ backgroundColor: accent }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v5" />
          <path d="M12 16.5v.01" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: accent }}>
          Some guests can&apos;t connect to calls
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-fg-secondary">
          {reason === "misconfigured"
            ? "The call relay is only half set up: TURN_URLS needs a turn: or turns: address and TURN_SECRET must be set."
            : "No call relay (TURN server) is set up."}{" "}
          People on mobile data, corporate networks or strict home routers join but can&apos;t be seen or heard. Set{" "}
          <code className="rounded bg-surface-2 px-1">TURN_URLS</code> and{" "}
          <code className="rounded bg-surface-2 px-1">TURN_SECRET</code> in the deployment&apos;s environment — the
          steps are in <code className="rounded bg-surface-2 px-1">docs/infra/turn-server.md</code>.
        </p>
      </div>

      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setShow(false);
          try {
            window.localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            // Dismissed for this render either way.
          }
        }}
        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
