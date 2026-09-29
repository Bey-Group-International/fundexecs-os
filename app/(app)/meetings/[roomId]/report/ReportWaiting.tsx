"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** The same cadence the client page used. */
export const POLL_INTERVAL = 5000;

/**
 * The spinner that goes looking.
 *
 * A report is written by a background route some seconds after the meeting ends,
 * so somebody sent here the moment they hang up arrives before it exists. That
 * is the one genuinely live thing on this page, and it is the only reason any of
 * it ever needed to poll.
 *
 * So this is what is left of the client page: a component that knows nothing
 * about reports except whether one has appeared. When one has,
 * `router.refresh()` re-runs the server component and the finished document
 * replaces this — with no client-side fetch of the meeting, the attendance, the
 * transcript, the recordings or the chat, because the server reads all of those
 * in one pass.
 *
 * It asks a route rather than the database, so there is no second copy of the
 * RLS reasoning in the browser, and the route answers from the same loader the
 * page renders from.
 */
export function ReportWaiting({ roomId, stopAfterMs }: { roomId: string; stopAfterMs: number }) {
  const router = useRouter();
  /**
   * When to give up, computed ONCE from the server's own view of how late the
   * report already is.
   *
   * Recomputed per tick it would never expire, which is the "spinner for the
   * life of the tab" the wait limit exists to prevent. Taken from the server
   * rather than from mount so a page opened on a five-minute-old meeting waits
   * the remaining minute, not a fresh six.
   */
  const deadline = useRef(Date.now() + stopAfterMs);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function look() {
      if (cancelled) return;

      if (Date.now() >= deadline.current) {
        // Out of patience. One more refresh so the SERVER decides what to show:
        // it renders the stalled state, which is different advice rather than
        // the same spinner forever.
        router.refresh();
        return;
      }

      try {
        const res = await fetch(
          `/api/meetings/rooms/${encodeURIComponent(roomId)}/report/status`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { waiting?: boolean };
          if (cancelled) return;
          // Anything that is no longer waiting ends the poll and hands the
          // decision back to the server — ready, unsummarised, forbidden and
          // stalled all render differently, and none of them is this component's
          // business to distinguish.
          if (body.waiting === false) {
            router.refresh();
            return;
          }
        }
        // A non-OK answer is not a reason to stop: a route hiccup or an expired
        // session costs one wasted tick, and giving up here would leave a real
        // report behind a permanent spinner.
      } catch {
        // Offline, or the request was cut off. Same answer: look again.
      }

      if (!cancelled) timer = setTimeout(look, POLL_INTERVAL);
    }

    timer = setTimeout(look, POLL_INTERVAL);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [roomId, router]);

  return null;
}
