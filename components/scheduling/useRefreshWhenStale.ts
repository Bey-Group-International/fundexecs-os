"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * How old a list of open times may get before coming back to the tab reloads
 * it. Long enough that switching away to check a calendar and back costs
 * nothing; short enough that an invitee who left the page open over lunch is
 * not choosing from times that went while they were gone.
 */
export const SLOTS_STALE_MS = 5 * 60_000;

/**
 * Reload when someone returns to a tab whose data has gone stale.
 *
 * A public booking link is exactly the page that gets opened from an email,
 * left in a tab, and finished later. Without this, the times it showed were the
 * ones it loaded with, however long ago: the invitee picked one, filled in the
 * form, and only learned it was gone from the 409 on submit.
 *
 * Returns `markFresh`, to call after every successful load. The clock starts at
 * mount, since a page arrives holding data the server just read.
 */
export function useRefreshWhenStale(
  refresh: () => void,
  { enabled = true, staleMs = SLOTS_STALE_MS }: { enabled?: boolean; staleMs?: number } = {},
): () => void {
  const loadedAt = useRef(Date.now());
  const refreshRef = useRef(refresh);
  const enabledRef = useRef(enabled);
  refreshRef.current = refresh;
  enabledRef.current = enabled;

  const markFresh = useCallback(() => {
    loadedAt.current = Date.now();
  }, []);

  useEffect(() => {
    function onReturn() {
      if (document.visibilityState !== "visible" || !enabledRef.current) return;
      if (Date.now() - loadedAt.current < staleMs) return;
      // Marked before the reload, so the focus and visibility events that
      // arrive together on a tab switch start one reload, not two.
      loadedAt.current = Date.now();
      refreshRef.current();
    }
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [staleMs]);

  return markFresh;
}
