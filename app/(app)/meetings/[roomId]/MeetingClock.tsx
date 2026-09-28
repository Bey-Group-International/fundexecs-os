"use client";

import { useEffect, useState } from "react";
import {
  elapsedSeconds,
  formatElapsed,
  monotonicNow,
  type ElapsedState,
} from "@/lib/meetings/elapsed";

/**
 * How long the meeting has been running.
 *
 * This is a leaf on purpose, and it is the whole point of the component.
 *
 * The clock used to be a number in MeetingRoom's own state, advanced by a
 * one-second interval. MeetingRoom is a four-and-a-half-thousand-line component
 * that renders every video tile in the call, so a second hand in the control bar
 * was re-rendering every face in the room once a second, for the length of the
 * meeting, on the same main thread that decodes the video. Nothing else on
 * screen changed. Moving the tick down here means the per-second re-render is
 * this `<span>` and nothing else.
 *
 * The state arrives as a REF rather than a value, so the parent's props do not
 * change when time passes — a ref object keeps its identity forever, which is
 * exactly the property needed to stop the parent re-rendering. The ref is read
 * on each tick; the tick only decides WHEN to look, never what the answer is.
 * That separation is what makes the rest of this safe: the clock can skip as
 * many ticks as the browser likes and still be right the moment it renders,
 * because the answer is arithmetic on timestamps (see lib/meetings/elapsed.ts).
 *
 * Which is why it can sleep. While the tab is hidden nobody is reading it, and
 * on return it reads the real elapsed time rather than resuming a count that
 * fell behind. A counter could not have afforded that.
 */
export function MeetingClock({
  elapsed,
  className = "",
}: {
  /** Live span bookkeeping, owned by the room. Read, never written. */
  elapsed: { readonly current: ElapsedState };
  className?: string;
}) {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(elapsed.current, monotonicNow()));

  // `elapsed` is a ref object, so its identity never changes and this effect runs
  // once for the life of the clock. Listing it anyway rather than reaching for a
  // latest-value ref: the dependency is honest, and a caller who passed a fresh
  // object every render would get a restarted interval instead of a silently
  // stale closure.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const read = () => setSeconds(elapsedSeconds(elapsed.current, monotonicNow()));
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    function start() {
      if (id !== null) return;
      id = setInterval(read, 1000);
    }

    function stop() {
      if (id === null) return;
      clearInterval(id);
      id = null;
    }

    function onVisibility() {
      if (hidden()) {
        stop();
        return;
      }
      // Read before resuming, not on the next tick: the first thing somebody
      // sees on coming back should be the time now, not the time they left.
      read();
      start();
    }

    read();
    if (!hidden()) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [elapsed]);

  return (
    <span
      className={className}
      // The clock changes every second, which a screen reader should not be
      // reading out over the meeting. The duration is not news; it is furniture.
      aria-hidden="true"
    >
      {formatElapsed(seconds)}
    </span>
  );
}
