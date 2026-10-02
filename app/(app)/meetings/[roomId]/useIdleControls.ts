"use client";

// Whether the call's controls are showing.
//
// The bar along the bottom of the call is 64px of the screen that nobody looks
// at while they are listening, and on a laptop that is a tenth of the height
// the faces could have. So on a screen with a mouse it steps aside once the
// pointer has rested for a few seconds, and the stage takes the room; moving
// the mouse or pressing a key brings it straight back.
//
// The rule for when it may go is `controlsMayHide`. This hook supplies the two
// things only the page knows — whether the pointer is a mouse, and whether a
// menu or the focus is somewhere the person is still using — and the timer.
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTROLS_IDLE_MS, controlsMayHide, type RoomViewport } from "@/lib/meetings/room-layout";

export function useIdleControls({
  live,
  waitingCount,
  barRef,
}: {
  /** In the call proper. The lobby and the ending screen never hide anything. */
  live: boolean;
  /** People the host has waiting at the door. While any are, the bar stays. */
  waitingCount: number;
  /** The bar, so focus inside it or the pointer over it counts as use. */
  barRef: React.RefObject<HTMLElement | null>;
}): { visible: boolean; reveal: () => void } {
  const [visible, setVisible] = useState(true);
  const [finePointer, setFinePointer] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.("(hover: hover) and (pointer: fine)") : null;
    if (!mq) return;
    const update = () => setFinePointer(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const allowed = finePointer && live && waitingCount === 0;

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(function attempt() {
      const bar = barRef.current;
      const may = controlsMayHide({
        finePointer,
        live,
        waitingCount,
        // Every menu the bar opens portals to the body with this role.
        menuOpen: Boolean(document.querySelector('[role="menu"]')),
        focusInside: keyboardFocusIn(bar),
      });
      // Resting the pointer on the bar is using it, not leaving it idle.
      if (may && !hovered(bar)) setVisible(false);
      // Something is still in use: look again rather than give up, so the bar
      // goes once the menu closes without needing another mouse move.
      else timer.current = setTimeout(attempt, CONTROLS_IDLE_MS);
    }, CONTROLS_IDLE_MS);
  }, [barRef, finePointer, live, waitingCount]);

  const reveal = useCallback(() => {
    setVisible(true);
    schedule();
  }, [schedule]);

  useEffect(() => {
    if (!allowed) {
      if (timer.current) clearTimeout(timer.current);
      setVisible(true);
      return;
    }
    schedule();
    const onActivity = () => reveal();
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [allowed, schedule, reveal]);

  return { visible: visible || !allowed, reveal };
}

/**
 * Keyboard focus inside the bar. A mouse press focuses the button it lands on
 * too, and that must not pin the bar open for good — only focus that arrived by
 * keyboard, which is what `:focus-visible` tells apart, means someone is
 * working the controls without a pointer.
 */
function keyboardFocusIn(bar: HTMLElement | null): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!bar || !el || !bar.contains(el)) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

function hovered(bar: HTMLElement | null): boolean {
  try {
    return Boolean(bar?.matches(":hover"));
  } catch {
    return false;
  }
}

/**
 * Phone-sized or not, by the same 640px line the room's `sm:` classes draw.
 * "desktop" until mounted, which is what the server would have assumed.
 */
export function useRoomViewport(): RoomViewport {
  const [viewport, setViewport] = useState<RoomViewport>("desktop");
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 639px)");
    if (!mq) return;
    const update = () => setViewport(mq.matches ? "mobile" : "desktop");
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return viewport;
}
