'use client';

import { useEffect } from 'react';
import { markVisited } from '@/lib/actions/dashboard';

/**
 * MarkVisited — records "the operator saw the desk now", AFTER this render has
 * already computed the "since you were away" summary against the prior visit.
 * Runs once on mount (post-paint), so this visit becomes the baseline for the
 * next one without affecting what the current render shows. Renders nothing.
 */
export function MarkVisited() {
  useEffect(() => {
    void markVisited();
  }, []);
  return null;
}
