'use client';

import { ArrowRight, Sparkles } from 'lucide-react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { Badge } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { SmoothScrollLink } from '@/components/landing/SmoothScrollLink';
import { HeroStats } from '@/components/landing/HeroStats';
import { Magnetic } from '@/components/landing/Motion';
import { PRIMARY_CTA, SECONDARY_CTA } from '@/components/landing/cta';
import { useRequestAccess } from '@/components/landing/RequestAccessContext';
import { getCOO } from '@/lib/team';

/**
 * Hero — the cinematic, pointer-reactive opener. A drifting aurora + grid
 * backdrop, a cursor-following spotlight, a parallax/tilting Earn coin, an
 * animated gradient headline, and magnetic CTAs. Fully static under
 * reduced-motion (the spotlight/tilt simply don't track).
 */
export function Hero() {
  const earn = getCOO();
  const reduce = useReducedMotion();
  const { open: openRequestAccess } = useRequestAccess();

  // Normalized pointer position (-0.5..0.5) across the hero, spring-smoothed.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 20, mass: 0.5 });
  const sy = useSpring(py, { stiffness: 120, damping: 20, mass: 0.5 });

  // Coin tilt + drift from pointer.
  const rotateY = useTransform(sx, [-0.5, 0.5], [14, -14]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [-14, 14]);
  const driftX = useTransform(sx, [-0.5, 0.5], [-18, 18]);
  const driftY = useTransform(sy, [-0.5, 0.5], [-14, 14]);

  // Spotlight position in %.
  const spotX = useTransform(sx, [-0.5, 0.5], ['30%', '70%']);
  const spotY = useTransform(sy, [-0.5, 0.5], ['25%', '75%']);
  const spotlightBg = useTransform(
    [spotX, spotY],
    ([x, y]) => `radial-gradient(420px circle at ${x} ${y}, rgba(247,201,72,0.12), transparent 60%)`
  );

  function onMove(e: React.MouseEvent<HTMLElement>) {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  }

  return (
    <section
      onMouseMove={onMove}
      className="relative overflow-hidden pb-20 pt-28 sm:pb-24 sm:pt-36"
      aria-labelledby="hero-heading"
    >
      {/* Aurora + base gradient */}
      <div
        className="fx-aurora absolute inset-0 -z-20"
        style={{
          background:
            'radial-gradient(55% 50% at 70% 18%, rgba(247,201,72,0.18), transparent 70%), radial-gradient(50% 55% at 18% 78%, rgba(37,99,235,0.18), transparent 72%), linear-gradient(180deg, var(--bg-0) 0%, var(--bg-1) 100%)'
        }}
        aria-hidden
      />
      {/* Faint grid texture */}
      <div
        className="fx-grid-pan absolute inset-0 -z-20 opacity-[0.5]"
        style={{
          backgroundImage:
            'linear-gradient(var(--hairline) 1px, transparent 1px), linear-gradient(90deg, var(--hairline) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(80% 60% at 50% 35%, #000 0%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(80% 60% at 50% 35%, #000 0%, transparent 80%)'
        }}
        aria-hidden
      />
      {/* Cursor spotlight */}
      {!reduce ? (
        <motion.div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: spotlightBg }}
          aria-hidden
        />
      ) : null}

      <div className="mx-auto grid max-w-[1180px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <Badge tone="gold" dot pulse className="mb-6">
              Led by Earn · your live AI executive team
            </Badge>
          </motion.div>

          <motion.h1
            id="hero-heading"
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1], delay: 0.06 }}
            className="text-[42px] font-semibold leading-[1.04] tracking-[-0.025em] text-fg-1 sm:text-6xl lg:text-[68px]"
          >
            Unified intelligence layer for
            <br className="hidden sm:block" />{' '}
            <span className={reduce ? 'text-gold-1' : 'fx-text-gradient'}>
              private market operators
            </span>
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1], delay: 0.14 }}
            className="mt-6 max-w-xl text-[17px] leading-7 text-fg-3 sm:text-[18px]"
          >
            Fifteen AI specialists — led by Earn — source deals, raise capital, run diligence, and
            drive to signed close. The firepower of a full investment bank, on your desk, working
            around the clock. Your competitors are still doing it by hand.
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 0.61, 0.36, 1], delay: 0.22 }}
            className="mt-9 flex flex-wrap items-center gap-4"
          >
            <Magnetic>
              <button
                type="button"
                onClick={() => openRequestAccess('landing-hero')}
                className={PRIMARY_CTA}
              >
                Request access
                <ArrowRight size={17} strokeWidth={2} aria-hidden />
              </button>
            </Magnetic>
            <SmoothScrollLink targetId="preview" className={SECONDARY_CTA}>
              <Sparkles size={16} strokeWidth={2} aria-hidden />
              See it in motion
            </SmoothScrollLink>
          </motion.div>

          <p className="mt-4 text-[12.5px] text-fg-5">
            Invite-only.{' '}
            <span className="text-fg-3">We&rsquo;re onboarding a limited cohort this quarter.</span>
          </p>

          <HeroStats />
        </div>

        {/* Hero mascot — parallax + tilt to pointer */}
        <div className="flex flex-col items-center lg:col-span-5 lg:items-end">
          <motion.div
            className="relative"
            style={
              reduce
                ? undefined
                : { rotateX, rotateY, x: driftX, y: driftY, transformPerspective: 900 }
            }
          >
            <div
              className="fx-glow-pulse pointer-events-none absolute inset-0 -z-10"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.45), transparent 65%)',
                filter: 'blur(46px)'
              }}
              aria-hidden
            />
            <EarnCoin
              size={300}
              glow
              online
              className="fx-coin-float h-48 w-48 sm:h-60 sm:w-60 lg:h-72 lg:w-72"
            />
          </motion.div>
          <div className="mt-7 text-center lg:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-1">
              Meet Earn
            </p>
            <p className="mt-1.5 text-[15px] font-semibold text-fg-1">
              {earn.name} &ldquo;Earn&rdquo;
            </p>
            <p className="mt-0.5 text-[12px] text-fg-4">{earn.position} · your live AI guide</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
