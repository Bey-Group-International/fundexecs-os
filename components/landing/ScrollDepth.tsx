'use client';

import { useEffect } from 'react';
import { track } from '@/lib/landing/analytics';

const MILESTONES = [25, 50, 75, 100] as const;

/**
 * ScrollDepth — renders nothing; emits one `landing_scroll_depth` event per
 * milestone (25/50/75/100%) the first time the visitor scrolls past it, so
 * the funnel shows how far down the long landing page people actually get.
 */
export function ScrollDepth() {
  useEffect(() => {
    const fired = new Set<number>();

    function onScroll() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const pct = ((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100;
      for (const m of MILESTONES) {
        if (pct >= m && !fired.has(m)) {
          fired.add(m);
          track('landing_scroll_depth', { depth: m });
        }
      }
      if (fired.size === MILESTONES.length) {
        window.removeEventListener('scroll', onScroll);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return null;
}

export default ScrollDepth;
