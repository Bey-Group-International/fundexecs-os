"use client";

import { useEffect, useState } from "react";

// Tracks scroll direction on the document — the app shell in
// app/(app)/layout.tsx lets the page (window) scroll rather than an inner
// `overflow-y-auto` <main>, so the browser can hide its toolbars, anchor
// jumps/scroll restoration work, and fixed overlays resolve to the viewport.
// Returns `true` when the chrome (bottom nav + FAB) should hide: the user is
// scrolling DOWN and has moved past a small offset. Scrolling up, or resting
// near the top, reveals it again. This is the standard native "content-first"
// behavior and is purely presentational — nothing depends on it.
export function useHideOnScroll(threshold = 8): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
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

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return hidden;
}
