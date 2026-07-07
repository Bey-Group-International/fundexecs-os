"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "./haptics";

// Mounted once, globally, in the app layout. On mobile, operators keep the PWA
// backgrounded and resume it constantly — by which point their login cookie may
// have expired. Instead of letting every tap silently fail against a 401, this
// guard proactively checks the session on resume and, if it's gone, throws up a
// blocking "sign back in" overlay so the on-the-go user knows exactly why their
// actions stopped working. Desktop/web is untouched (md:hidden throughout).

// Don't re-probe more than once per 30s — resume + online can fire together.
const CHECK_DEBOUNCE_MS = 30_000;

export function SessionGuard() {
  const [expired, setExpired] = useState(false);
  const lastCheck = useRef(0);
  // Guard against a haptic double-fire if two checks race to set expiry.
  const notified = useRef(false);

  const check = useCallback(async () => {
    // Offline devices can't tell us "expired" vs "unreachable" — skip so we
    // never accuse a valid session of being dead just because the user is in a
    // tunnel or elevator.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const now = Date.now();
    if (now - lastCheck.current < CHECK_DEBOUNCE_MS) return;
    lastCheck.current = now;

    try {
      const res = await fetch("/api/session/check", {
        credentials: "same-origin",
        cache: "no-store",
      });
      let ok = res.ok;
      try {
        const body = (await res.json()) as { ok?: boolean };
        if (body?.ok === false) ok = false;
      } catch {
        /* non-JSON body — fall back to the HTTP status above */
      }
      if (!ok) {
        setExpired(true);
        if (!notified.current) {
          notified.current = true;
          haptic("warn");
        }
      }
    } catch {
      /* network error — a blip or offline, NOT proof of expiry; do nothing */
    }
  }, []);

  useEffect(() => {
    // Probe once on mount, then on every foreground resume and reconnect —
    // exactly the moments a stale cookie surfaces for a mobile operator.
    void check();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onOnline = () => void check();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [check]);

  if (!expired) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6 md:hidden print:hidden">
      <div className="rounded-3xl border border-line bg-surface-1 p-6 text-center max-w-sm w-full">
        <span
          aria-hidden
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 text-gold-300"
        >
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x={4} y={10} width={16} height={11} rx={2.5} />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <circle cx={12} cy={15.5} r={1.4} />
          </svg>
        </span>
        <h2 className="font-display text-xl font-semibold text-fg-primary mt-4">Session expired</h2>
        <p className="text-[13px] text-fg-secondary mt-2">
          For your security you&apos;ve been signed out. Sign back in to pick up where you left off.
        </p>
        {/* Plain <a>: a full navigation re-runs auth from scratch, rather than a
            client transition that would inherit the dead session. */}
        <a
          href="/login"
          className="fx-tap mt-5 block rounded-2xl bg-gradient-to-br from-gold-300 to-gold-500 py-3 text-[14px] font-semibold text-surface-0"
        >
          Sign back in
        </a>
      </div>
    </div>
  );
}
