"use client";

import { useEffect, useState } from "react";

// Tracks scroll direction on the app's main scroll container (the `<main>` in
// app/(app)/layout.tsx, which is `overflow-y-auto` — so window scroll never
// fires). Returns `true` when the chrome (bottom nav + FAB) should hide: the
// user is scrolling DOWN and has moved past a small offset. Scrolling up, or
// resting near the top, reveals it again. This is the standard native
// "content-first" behavior and is purely presentational — nothing depends on it.
export function useHideOnScroll(threshold = 8): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const scroller = document.querySelector("main");
    if (!scroller) return;

    let lastY = scroller.scrollTop;
    let ticking = false;

    const update = () => {
      const y = scroller.scrollTop;
      const dy = y - lastY;
      // Always reveal near the top; ignore tiny jitters and rubber-banding.
      if (y < 24) {
        setHidden(false);
      } else if (Math.abs(dy) > threshold) {
        setHidden(dy > 0);
      }
      lastY = y;
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return hidden;
}
