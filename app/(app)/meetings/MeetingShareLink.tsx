"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canNativeShare,
  displayUrl,
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
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

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

  const copy = useCallback(async () => {
    const ok = await copyText(url);
    setCopied(ok);
    setCopyFailed(!ok);
    setTimeout(() => { setCopied(false); setCopyFailed(false); }, 2000);
  }, [url]);

  const share = useCallback(async () => {
    try {
      await (navigator as ShareCapableNavigator).share?.(target);
    } catch {
      // A cancelled share sheet rejects exactly like a failed one. Either way
      // there is nothing to report — the member simply changed their mind.
    }
  }, [target]);

  if (!url) return null;

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      {!compact && (
        <span
          title={url}
          className="flex-1 min-w-0 truncate font-mono text-xs text-[var(--fg-secondary)] bg-[var(--surface-2)] rounded-md px-2 py-1 select-all"
        >
          {displayUrl(url)}
        </span>
      )}

      <button
        type="button"
        onClick={() => void copy()}
        title={`Copy ${url}`}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-2)] transition-colors"
      >
        <LinkIcon />
        {copied ? "Copied" : copyFailed ? "Press ⌘C" : "Copy link"}
      </button>

      {shareable && (
        <button
          type="button"
          onClick={() => void share()}
          title="Share this meeting"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:bg-[var(--surface-2)] transition-colors"
        >
          <ShareIcon />
          Share
        </button>
      )}
    </div>
  );
}
