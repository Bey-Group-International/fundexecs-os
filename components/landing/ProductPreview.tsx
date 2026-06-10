'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, TrendingUp } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { Reveal } from '@/components/landing/Motion';

/* ============================================================================
 * ProductPreview — the "See it in motion" #preview section. Renders a real
 * demo video when one is available (see DEMO_VIDEO_SRC below); until then, a
 * faux Earn workspace that "comes alive" as it scrolls into view — Earn
 * streams a reply, KPI bars fill, pipeline rows deal in — and replays on a
 * loop while on screen, so the section actually moves. No real data; it's an
 * animated illustration of the product. Static under reduced-motion.
 * ========================================================================= */

/**
 * Demo asset slot.
 *
 * TODO(team): when a real command-center screen recording exists, drop it in
 * `public/` (e.g. `/demo/command-center.mp4`, H.264, ~30s, no audio needed)
 * and set this to its path. It renders muted/looping/autoplaying inside the
 * window chrome in place of the animated mock; under `prefers-reduced-motion`
 * it does not autoplay and shows controls instead.
 */
const DEMO_VIDEO_SRC: string | null = null;

/** How long one mock "take" plays before it replays (ms). */
const MOCK_LOOP_MS = 9000;

const EASE = [0.22, 0.61, 0.36, 1] as const;

const KPIS = [
  { label: 'Capital in motion', value: '$612M', pct: 78, tone: 'var(--gold-1)' },
  { label: 'Live deals', value: '24', pct: 61, tone: 'var(--azure-1)' },
  { label: 'Close probability', value: '92%', pct: 92, tone: 'var(--success)' }
];

const PIPELINE = [
  { name: 'Project Atlas — Series B', stage: 'Term sheet', amt: '$45M', tone: 'var(--success)' },
  { name: 'Meridian Fund II', stage: 'Diligence', amt: '$120M', tone: 'var(--azure-1)' },
  { name: 'Northwind Acquisition', stage: 'IC review', amt: '$88M', tone: 'var(--gold-1)' }
];

function ChatPanel({ reduce }: { reduce: boolean | null }) {
  return (
    <div className="flex flex-col gap-3 border-b border-hairline p-4 sm:border-b-0 sm:border-r">
      <div className="flex items-center gap-2">
        <EarnCoin size={22} online />
        <span className="text-[12px] font-semibold text-fg-1">Earn</span>
        <span className="text-[10.5px] text-fg-5">Chief Operating Officer</span>
      </div>

      {/* User prompt */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm border border-hairline bg-surface-2 px-3 py-2 text-[12px] text-fg-2"
      >
        Earn, what should I move on today?
      </motion.div>

      {/* Earn reply, streams in line-by-line */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.45, ease: EASE, delay: 0.5 }}
        className="max-w-[92%] rounded-2xl rounded-tl-sm border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2.5"
      >
        <p className="text-[12px] leading-5 text-fg-2">
          Three things. <span className="font-semibold text-fg-1">Project Atlas</span> term sheet is
          ready to counter — I drafted it.
        </p>
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.5 }}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.18, delayChildren: 0.9 } }
          }}
          className="mt-2 flex flex-col gap-1.5"
        >
          {[
            'Countersigned NDA for Meridian',
            'Flagged a covenant risk in Northwind',
            'Booked 2 LP intro calls for Thursday'
          ].map((t) => (
            <motion.li
              key={t}
              variants={{
                hidden: reduce ? {} : { opacity: 0, x: -6 },
                show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } }
              }}
              className="flex items-center gap-1.5 text-[11.5px] text-fg-3"
            >
              <Check size={13} strokeWidth={2.4} className="flex-none text-success" aria-hidden />
              {t}
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </div>
  );
}

function MetricsPanel({ reduce }: { reduce: boolean | null }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-3 gap-3">
        {KPIS.map((k, i) => (
          <motion.div
            key={k.label}
            initial={reduce ? false : { opacity: 0, y: 12 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.1 * i }}
            className="rounded-xl border border-hairline bg-surface-1 p-3"
          >
            <div className="text-[17px] font-semibold leading-none tracking-[-0.02em] text-fg-1">
              {k.value}
            </div>
            <div className="mt-1 text-[10px] leading-tight text-fg-4">{k.label}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className="h-full rounded-full"
                style={{ background: k.tone }}
                initial={reduce ? false : { width: 0 }}
                whileInView={reduce ? undefined : { width: `${k.pct}%` }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.2 + 0.1 * i }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="rounded-xl border border-hairline bg-surface-1 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-fg-2">Live pipeline</span>
          <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-success">
            <TrendingUp size={12} strokeWidth={2.2} aria-hidden /> +18% MoM
          </span>
        </div>
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.12, delayChildren: 0.3 } }
          }}
          className="flex flex-col gap-1.5"
        >
          {PIPELINE.map((p) => (
            <motion.li
              key={p.name}
              variants={{
                hidden: reduce ? {} : { opacity: 0, y: 8 },
                show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } }
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-surface-2"
            >
              <span
                className="h-2 w-2 flex-none rounded-full"
                style={{ background: p.tone, boxShadow: `0 0 8px ${p.tone}` }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-fg-2">
                {p.name}
              </span>
              <span className="flex-none text-[10.5px] text-fg-5">{p.stage}</span>
              <span className="flex-none text-[11px] font-semibold tabular-nums text-fg-1">
                {p.amt}
              </span>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </div>
  );
}

export function ProductPreview() {
  const reduce = useReducedMotion();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  // Remount key for the mock panels — bumping it replays their entrance/stream
  // animations, turning the one-shot scroll reveal into a loop.
  const [take, setTake] = useState(0);

  useEffect(() => {
    const node = frameRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { threshold: 0.3 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    // Replay only while visible, only for the mock, never under reduced motion.
    if (reduce || DEMO_VIDEO_SRC || !inView) return;
    const timer = setInterval(() => setTake((t) => t + 1), MOCK_LOOP_MS);
    return () => clearInterval(timer);
  }, [reduce, inView]);

  return (
    <section id="preview" className="py-16 sm:py-24" aria-labelledby="preview-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            Your command center
          </p>
          <h2
            id="preview-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            One desk. Every move, already made for you.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            Ask in plain English. Earn and the team return drafted terms, verified diligence, and
            the next best action — not a to-do list. You approve; they execute.
          </p>
        </Reveal>

        <Reveal y={28}>
          <div className="relative">
            {/* Glow base */}
            <div
              className="pointer-events-none absolute -inset-x-10 -bottom-10 top-10 -z-10 blur-3xl"
              style={{
                background:
                  'radial-gradient(60% 60% at 30% 30%, rgba(247,201,72,0.12), transparent 70%), radial-gradient(60% 60% at 75% 70%, rgba(37,99,235,0.14), transparent 70%)'
              }}
              aria-hidden
            />
            <div className="relative overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)]">
              {/* gloss sweep */}
              {!reduce ? (
                <div
                  className="fx-sweep pointer-events-none absolute inset-y-0 -left-1/3 -z-0 w-1/3 skew-x-12 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
                  aria-hidden
                />
              ) : null}

              {/* window chrome */}
              <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" aria-hidden />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" aria-hidden />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" aria-hidden />
                <span className="ml-3 inline-flex items-center gap-1.5 text-[11px] text-fg-4">
                  <EarnCoin size={14} /> fundexecs.os / command-center
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-medium text-azure-1">
                  <ArrowUpRight size={12} strokeWidth={2.2} aria-hidden /> Live
                </span>
              </div>

              <div ref={frameRef}>
                {DEMO_VIDEO_SRC ? (
                  <video
                    src={DEMO_VIDEO_SRC}
                    className="block w-full"
                    muted
                    loop
                    playsInline
                    autoPlay={!reduce}
                    controls={Boolean(reduce)}
                    preload="metadata"
                    aria-label="FundExecs command center demo"
                  />
                ) : (
                  <div key={take} className="grid sm:grid-cols-2">
                    <ChatPanel reduce={reduce} />
                    <MetricsPanel reduce={reduce} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default ProductPreview;
