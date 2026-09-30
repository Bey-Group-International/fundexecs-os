"use client";

import { useEffect } from "react";

// When the Documents library is opened via a deep link from the readiness
// next-best action (/build/documents#section-<key>), scroll the matching
// section into view and briefly highlight it so the operator sees exactly
// where to act. No-op when there's no matching section hash.
const RING = ["ring-2", "ring-gold-400", "ring-offset-2", "ring-offset-surface-0"];

export function SectionHighlighter() {
  useEffect(() => {
    let timer = 0;
    const flash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#section-")) return;
      const el = document.getElementById(hash.slice(1));
      if (!el) return;
      // Only move the page if the section isn't already fully on screen, and
      // then by the least amount (`nearest`) and instantly. The browser has
      // usually already jumped to the #hash target on load, so a second smooth
      // `center` scroll re-animated the page for no reason and fought the
      // reader if they had started scrolling. "On screen" starts below the
      // sticky top bar, which the app shell exposes as scroll-padding-top
      // (scrollIntoView honours it too).
      const topInset =
        parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const r = el.getBoundingClientRect();
      const inView = r.top >= topInset && r.bottom <= window.innerHeight;
      if (!inView) el.scrollIntoView({ block: "nearest" });
      el.classList.add(...RING);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => el.classList.remove(...RING), 2200);
    };
    // Fire on mount (cross-page deep link) and on same-page hash changes.
    flash();
    window.addEventListener("hashchange", flash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", flash);
    };
  }, []);

  return null;
}
