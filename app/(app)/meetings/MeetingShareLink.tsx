"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canNativeShare,
  displayUrl,
  inviteTextFor,
  meetingInviteUrl,
  shareTargetFor,
  type ShareCapableNavigator,
} from "@/lib/meetings/share";

/**
 * Copy the text without the async clipboard API.
 *
 * `navigator.clipboard` is undefined outside a secure context and can be denied
 * by permissions policy. A meeting link that silently fails to copy is worse
 * than an old-fashioned one that works, so keep the fallback.
 */
function legacyCopy(text: string): boolean {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }
  return legacyCopy(text);
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

export interface MeetingShareLinkProps {
  roomCode: string;
  title?: string | null;
  scheduledAt?: string | null;
  timeZone?: string | null;
  /** Drops the URL line and leaves just the two buttons, for tight rows. */
  compact?: boolean;
  className?: string;
}

/**
 * A meeting's unique link, ready to copy or hand to the OS share sheet.
 *
 * The link is shown rather than hidden behind a button: someone about to paste
 * a meeting into a client thread wants to see which meeting it is first.
 */
export function MeetingShareLink({
  roomCode,
  title,
  scheduledAt,
  timeZone,
  compact = false,
  className = "",
}: MeetingShareLinkProps) {
  // The origin is only knowable in the browser, and rendering a link built from
  // a guessed origin would hydrate-mismatch. Empty until mounted, so the first
  // paint matches the server's.
  const [origin, setOrigin] = useState("");
  // Which button last succeeded, or failed. One piece of state rather than a
  // flag per button: copying the invite must not light up "Copied" under the
  // link button, which is what a shared boolean would do.
  const [flash, setFlash] = useState<{ what: "link" | "invite"; ok: boolean } | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const url = useMemo(() => meetingInviteUrl(origin, roomCode), [origin, roomCode]);
  const target = useMemo(
    () => shareTargetFor({ origin, roomCode, title, scheduledAt, timeZone }),
    [origin, roomCode, title, scheduledAt, timeZone],
  );

  const [shareable, setShareable] = useState(false);
  useEffect(() => {
    setShareable(canNativeShare(navigator as ShareCapableNavigator, target));
  }, [target]);

  const invite = useMemo(
    () => inviteTextFor({ origin, roomCode, title, scheduledAt, timeZone }),
    [origin, roomCode, title, scheduledAt, timeZone],
  );

  const copy = useCallback(async (what: "link" | "invite") => {
    const ok = await copyText(what === "link" ? url : invite);
    setFlash({ what, ok });
    setTimeout(() => setFlash(null), 2000);
  }, [url, invite]);

  const share = useCallback(async () => {
    try {
      await (navigator as ShareCapableNavigator).share?.(target);
    } catch {
      // A cancelled share sheet rejects exactly like a failed one. Either way
      // there is nothing to report — the member simply changed their mind.
    }
  }, [target]);

  if (!url) return null;

  const label = (what: "link" | "invite", idle: string) =>
    flash?.what === what ? (flash.ok ? "Copied" : "Press ⌘C") : idle;

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      {!compact && (
        <span
          title={url}
          className="min-w-0 flex-1 select-all truncate rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-fg-secondary"
        >
          {displayUrl(url)}
        </span>
      )}

      <button
        type="button"
        onClick={() => void copy("link")}
        title={`Copy ${url}`}
        className={BTN}
      >
        <LinkIcon />
        {label("link", "Copy link")}
      </button>

      {/* "Copy invite" only exists where there is something to say beyond the
          URL. In the control bar (compact) there is no room for it, and inside
          a call the people you would send it to are already in the room. */}
      {!compact && invite && (
        <button
          type="button"
          onClick={() => void copy("invite")}
          title="Copy the title, time and link as text"
          className={BTN}
        >
          <NoteIcon />
          {label("invite", "Copy invite")}
        </button>
      )}

      {shareable && (
        <button type="button" onClick={() => void share()} title="Share this meeting" className={BTN}>
          <ShareIcon />
          Share
        </button>
      )}

      {/* Announced rather than only coloured — the label change is the only
          feedback a copy gives, and a screen reader would otherwise get none. */}
      <span role="status" aria-live="polite" className="sr-only">
        {flash ? (flash.ok ? `${flash.what === "link" ? "Link" : "Invite"} copied` : "Copy failed") : ""}
      </span>
    </div>
  );
}

const BTN =
  "fx-btn shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs font-medium text-fg-secondary hover:bg-surface-2 hover:text-fg-primary";
