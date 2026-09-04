"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// The standing warning that meeting email cannot leave this deployment.
//
// Every meeting email — invitations, reschedules, cancellations, reminders —
// goes out through a connected Google mailbox. With none connected, sendEmail
// reports `channel: "in-app"` and the whole flow carries on: the meeting saves,
// the guest list is stored, and not one message is sent. That degrade is
// deliberate (a missing mailbox must never cost somebody their meeting) but it
// is invisible, and a host who never sees it assumes their guests were invited.
//
// Dismissible, because a member who has decided not to connect one should not
// be nagged on every visit. Per-browser only: the warning is a nudge, not a
// setting, and it comes back for the next person who has the same problem.
const DISMISS_KEY = "fx.meetings.mailboxWarning.dismissed";

export function MailboxWarning() {
  // Starts hidden and appears after mount. Rendering it during hydration would
  // flash a warning at somebody who dismissed it a moment ago.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(DISMISS_KEY) !== "1");
    } catch {
      // Private windows and blocked site data throw on access. Show it: the
      // warning is more useful than the dismissal is.
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
          Meeting email isn&apos;t being sent
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-fg-secondary">
          No Google mailbox is connected, so invitations, reschedules and reminders are saved but never delivered.{" "}
          <Link href="/settings/integrations" className="underline underline-offset-2 hover:text-fg-primary">
            Connect Google in Settings › Integrations
          </Link>{" "}
          and meeting email will send from it.
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
