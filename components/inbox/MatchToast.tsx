"use client";

// components/inbox/MatchToast.tsx
// The quick alert by the notification bell. When Earn lands a fresh ecosystem
// match in the inbox, this pops a small card in near the top bar: click it to
// open the inbox, or let it auto-dismiss and read it later — the alert lives on
// as a stored inbox thread either way. We remember the last alert we've shown in
// localStorage so it surfaces once per match, not on every navigation.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const SEEN_KEY = "fx_match_toast_seen_v1";
const AUTO_DISMISS_MS = 9000;
const EXIT_MS = 200;

export interface MatchToastAlert {
  id: string;
  title: string;
  body: string;
  href: string;
}

export function MatchToast({ alert }: { alert: MatchToastAlert | null }) {
  const router = useRouter();
  // `open` mounts the card; `shown` drives the enter/exit transition.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);

  const markSeen = useCallback(() => {
    if (!alert) return;
    try {
      localStorage.setItem(SEEN_KEY, alert.id);
    } catch {
      // private mode / storage disabled — non-fatal, the toast just isn't sticky
    }
  }, [alert]);

  const close = useCallback(() => {
    setShown(false);
    markSeen();
    const t = setTimeout(() => setOpen(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [markSeen]);

  useEffect(() => {
    if (!alert) return;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      seen = null;
    }
    if (seen === alert.id) return; // already surfaced this match

    setOpen(true);
    const raf = requestAnimationFrame(() => setShown(true));
    const dismiss = setTimeout(() => close(), AUTO_DISMISS_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(dismiss);
    };
  }, [alert, close]);

  if (!open || !alert) return null;

  function openInbox() {
    markSeen();
    setShown(false);
    router.push(alert!.href);
    setTimeout(() => setOpen(false), EXIT_MS);
  }

  return (
    <div className="pointer-events-none fixed right-3 top-14 z-50 print:hidden">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto relative w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-gold-500/30 bg-surface-1 shadow-xl shadow-black/30 transition-all duration-200 ${
          shown ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
        {/* Gold accent rail, echoing the bell badge. */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-gold-500/70" />
        <button
          type="button"
          onClick={openInbox}
          className="block w-full px-3.5 py-3 pr-8 text-left transition hover:bg-surface-2"
        >
          <div className="flex items-start gap-2.5">
            <span aria-hidden className="mt-0.5 text-base text-gold-400">
              ◈
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                Earn · new match
              </p>
              <p className="mt-1 truncate text-sm font-medium text-fg-primary">{alert.title}</p>
              {alert.body ? (
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-fg-secondary">
                  {alert.body}
                </p>
              ) : null}
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Click to open · or read later in your inbox
              </p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss"
          className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
        >
          ×
        </button>
      </div>
    </div>
  );
}
