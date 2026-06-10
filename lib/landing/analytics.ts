'use client';

import { track as vercelTrack } from '@vercel/analytics';

/**
 * lib/landing/analytics.ts
 * ------------------------
 * Thin funnel-instrumentation wrapper for the public landing surface.
 *
 * Vercel Analytics is the repo's canonical analytics (injected in
 * app/layout.tsx; `track` is already used by app/beta/*). All landing funnel
 * events route through THIS function so a future provider swap (PostHog, GA,
 * …) is a one-file change. Never throws — analytics must not break the page.
 *
 * Events emitted by the landing funnel:
 * - `landing_cta_click`        { cta, location }
 * - `request_access_open`      { source }
 * - `request_access_start`     { source }   (first field focused)
 * - `request_access_submit`    { source, ok }
 * - `landing_scroll_depth`     { depth }    (25 / 50 / 75 / 100)
 */
export function track(
  event: string,
  props?: Record<string, string | number | boolean | null>
): void {
  try {
    vercelTrack(event, props);
  } catch {
    /* never let analytics break the page */
  }
}
