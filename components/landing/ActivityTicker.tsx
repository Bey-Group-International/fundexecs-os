'use client';

import { useEffect, useRef, useState } from 'react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { ACTIVITY_SEED, getChainOfTrustActivity, type ActivityEntry } from '@/lib/landing/activity';

/** One pill in the scrolling marquee. */
function TickerPill({ entry }: { entry: ActivityEntry }) {
  const sep = (
    <span className="text-fg-5" aria-hidden>
      ·
    </span>
  );
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--gold-line)] bg-surface-1 px-3.5 py-2 text-[12.5px]">
      <EarnCoin size={18} />
      <span className="font-semibold text-fg-1">{entry.initials}</span>
      {sep}
      <span className="text-fg-3">{entry.role}</span>
      {sep}
      <span className="text-fg-3">{entry.region}</span>
      {sep}
      <span className="font-medium text-gold-1">{entry.type}</span>
      {sep}
      <span className="font-semibold text-fg-1">{entry.value}</span>
      {sep}
      <span className="text-fg-5">{entry.date}</span>
    </span>
  );
}

/** One card in the expanded "View all activity" grid. */
function ActivityCard({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface-1 p-4 shadow-[var(--shadow-md)]">
      <div className="mb-2 flex items-center gap-2">
        <EarnCoin size={20} />
        <span className="font-semibold text-fg-1">{entry.initials}</span>
        <span className="ml-auto text-[11px] text-fg-5">{entry.date}</span>
      </div>
      <div className="text-[13px] font-medium text-gold-1">
        {entry.type} · {entry.value}
      </div>
      <div className="mt-1 text-[11.5px] text-fg-4">
        {entry.role} · {entry.region}
      </div>
    </div>
  );
}

/**
 * ActivityTicker — the public landing page's "Live Activity" marquee.
 *
 * - Auto-scrolls (CSS marquee), pausing on hover/focus of the wrapper.
 * - Respects `prefers-reduced-motion`: renders a single statically-wrapping
 *   row with no auto-scroll instead of the duplicated, animated track.
 * - "View all activity" toggles a responsive grid of every entry.
 *
 * Data comes from `getChainOfTrustActivity()`. The ticker renders the bundled
 * `ACTIVITY_SEED` from the first paint — a "live" feed that opens empty or
 * with a loading shimmer on the first screen damages trust — and swaps in the
 * live feed if/when one resolves. To satisfy the repo's
 * `react-hooks/set-state-in-effect` rule, state is only ever set inside the
 * async `.then` continuation — never synchronously in the effect body
 * (mirrors `components/ui/AnimatedNumber.tsx`).
 */
export function ActivityTicker() {
  const [entries, setEntries] = useState<ActivityEntry[]>(ACTIVITY_SEED);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [inView, setInView] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    // Resolve reduced-motion preference (set in the async continuation, not
    // synchronously here, to avoid the set-state-in-effect lint).
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    Promise.resolve().then(() => {
      if (active && mq) setReduceMotion(mq.matches);
    });

    getChainOfTrustActivity().then((data) => {
      if (!active) return;
      setEntries(data);
    });

    return () => {
      active = false;
    };
  }, []);

  // Pause the marquee while it's off-screen — IntersectionObserver toggles
  // `data-in-view`; globals.css matches that attribute to pause the loop.
  // Keeps a 60-second linear loop from burning a GPU layer when no one
  // is looking. Hover/focus pause is handled by a separate selector and
  // still works while the ticker is in view.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
        }
      },
      { rootMargin: '0px', threshold: 0 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <section className="border-y border-hairline bg-bg-1" aria-labelledby="activity-heading">
      <div className="mx-auto max-w-[1180px] px-5 pt-6 sm:px-8">
        <div className="flex items-center justify-between">
          <h2
            id="activity-heading"
            className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-fg-4"
          >
            Live platform activity
          </h2>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              aria-controls="activity-grid"
              className="rounded-md text-[12px] font-medium text-gold-1 transition hover:text-gold-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              {showAll ? 'Hide activity' : 'View all activity'}
            </button>
          )}
        </div>
      </div>

      {/* Marquee. Hover/focus pauses the scroll; off-screen pause via the
          IntersectionObserver above sets data-in-view (see globals.css). */}
      <div
        ref={wrapRef}
        className="fx-marquee-wrap mt-4 overflow-hidden"
        data-in-view={inView}
        tabIndex={0}
        role="region"
        aria-label="Recent anonymized platform activity"
      >
        {reduceMotion ? (
          // Reduced motion: static, wrapping row — no auto-scroll.
          <div className="flex flex-wrap items-center gap-3 px-5 sm:px-8">
            {entries.map((e, i) => (
              <TickerPill key={`${e.initials}-${i}`} entry={e} />
            ))}
          </div>
        ) : (
          // Animated: duplicate the group so the loop is seamless. The second
          // copy is aria-hidden so screen readers don't read it twice.
          <div className="fx-marquee-animate flex w-max">
            <div className="flex items-center gap-3 pr-3">
              {entries.map((e, i) => (
                <TickerPill key={`a-${e.initials}-${i}`} entry={e} />
              ))}
            </div>
            <div className="flex items-center gap-3 pr-3" aria-hidden>
              {entries.map((e, i) => (
                <TickerPill key={`b-${e.initials}-${i}`} entry={e} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[1180px] px-5 pb-6 sm:px-8">
        {showAll && (
          <div id="activity-grid" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {entries.map((e, i) => (
              <ActivityCard key={`card-${e.initials}-${i}`} entry={e} />
            ))}
          </div>
        )}

        <p className="mt-5 max-w-3xl text-[11.5px] leading-relaxed text-fg-5">
          Activity is anonymized for confidentiality and shown to illustrate platform momentum. Not
          an offer or solicitation.
        </p>
      </div>
    </section>
  );
}

export default ActivityTicker;
