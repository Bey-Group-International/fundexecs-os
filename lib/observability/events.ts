/* ============================================================================
 * lib/observability/events.ts — tiny client-safe product-event tracker.
 *
 * The funnel counterpart to `log.ts`: one structured JSON line per product
 * event (event + context + ISO timestamp), greppable in any log drain, plus a
 * Sentry breadcrumb when `NEXT_PUBLIC_SENTRY_DSN` is set so events line up
 * against errors and replays. Sentry is imported lazily and every path is
 * best-effort — instrumentation must never throw into a real code path.
 *
 * Drop-in: `trackEvent('profile_resume_click', { score: 68 })`.
 * ========================================================================= */

/** Arbitrary structured context attached to an event. */
export type EventContext = Record<string, unknown>;

const sentryEnabled = !!process.env.NEXT_PUBLIC_SENTRY_DSN;

export function trackEvent(name: string, context?: EventContext): void {
  try {
    console.log(
      JSON.stringify({
        level: 'info',
        event: name,
        timestamp: new Date().toISOString(),
        ...context
      })
    );
  } catch {
    /* instrumentation must never break the caller */
  }

  if (!sentryEnabled) return;
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.addBreadcrumb({ category: 'product', message: name, data: context, level: 'info' });
    })
    .catch(() => {
      /* instrumentation must never break the caller */
    });
}

export default trackEvent;
