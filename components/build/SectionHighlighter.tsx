"use client";

import { useEffect } from "react";

// When the Materials & Data Room is opened via a deep link from the readiness
// next-best action (/build/data_room#section-<key>), scroll the matching
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
      el.scrollIntoView({ behavior: "smooth", block: "center" });
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
