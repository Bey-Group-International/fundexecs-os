'use client';

import type { AnchorHTMLAttributes, ReactNode } from 'react';

interface SmoothScrollLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Target element id (without the leading `#`). */
  targetId: string;
  children: ReactNode;
}

/**
 * SmoothScrollLink — an in-page anchor that smooth-scrolls to `targetId`.
 * Falls back to instant scroll under `prefers-reduced-motion`, and degrades
 * to a normal `#hash` link if JS is unavailable.
 */
export function SmoothScrollLink({ targetId, children, onClick, ...props }: SmoothScrollLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        const target = document.getElementById(targetId);
        if (!target) return;
        e.preventDefault();
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      }}
      {...props}
    >
      {children}
    </a>
  );
}

export default SmoothScrollLink;
