'use client';

import { useEffect, useRef } from 'react';
import { markVisited } from '@/lib/actions/dashboard';

/**
 * MarkVisited — invisible. Records "seen now" once per mount, AFTER the server
 * has already computed the "since you were away" summary against the prior
 * value. This makes the current visit the baseline for the next one. Failures
 * are swallowed: the worst case is the next banner counts from an older point.
 */
export function MarkVisited() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void markVisited().catch(() => {});
  }, []);
  return null;
}

export default MarkVisited;
