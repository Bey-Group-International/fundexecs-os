'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { Reveal, Stagger, StaggerItem } from '@/components/landing/Motion';
import { TeamAvatar, getCOO, getSpecialists, type TeamMember } from '@/lib/team';
import { cn } from '@/lib/utils';

/* ============================================================================
 * TeamConstellation — Earn at the center with the specialists orbiting on two
 * slow counter-rotating rings (decorative, aria-hidden), backed by an
 * accessible, scroll-staggered grid of every specialist. Orbit halts under
 * reduced-motion.
 * ========================================================================= */

/** Lay a list of members evenly around a ring of the given radius (px). */
function ringPositions(members: TeamMember[], radius: number, center: number) {
  return members.map((m, i) => {
    const angle = (360 / members.length) * i - 90; // start at top
    const rad = (angle * Math.PI) / 180;
    return {
      member: m,
      left: center + radius * Math.cos(rad),
      top: center + radius * Math.sin(rad)
    };
  });
}

function OrbitRing({
  members,
  radius,
  center,
  size,
  spinClass,
  counterClass,
  reduce
}: {
  members: TeamMember[];
  radius: number;
  center: number;
  size: number;
  spinClass: string;
  counterClass: string;
  reduce: boolean | null;
}) {
  const positions = ringPositions(members, radius, center);
  return (
    <div
      className={cn('absolute inset-0', !reduce && spinClass)}
      style={{ width: size, height: size }}
    >
      {/* the ring path */}
      <div
        className="absolute rounded-full border border-hairline"
        style={{ inset: center - radius, width: radius * 2, height: radius * 2 }}
        aria-hidden
      />
      {positions.map(({ member, left, top }) => (
        <div
          key={member.slug}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left, top }}
        >
          <div className={cn('transition-transform hover:scale-125', !reduce && counterClass)}>
            <TeamAvatar member={member} size={size > 440 ? 40 : 34} variant="disc" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Constellation({ reduce }: { reduce: boolean | null }) {
  const specialists = getSpecialists();
  const inner = specialists.slice(0, 6);
  const outer = specialists.slice(6);

  const size = 480;
  const center = size / 2;
  const boxRef = useRef<HTMLDivElement>(null);

  // Scale the fixed 480px coordinate system down to fit narrow containers.
  // Sets a CSS var via the ref (no React state → no set-state-in-effect lint).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = () => el.style.setProperty('--const-scale', String(el.clientWidth / size));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative mx-auto aspect-square w-full max-w-[480px]"
      aria-hidden
      style={{ maxWidth: size }}
    >
      {/* ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 blur-2xl"
        style={{
          background:
            'radial-gradient(40% 40% at 50% 50%, rgba(247,201,72,0.18), transparent 70%), radial-gradient(60% 60% at 50% 50%, rgba(37,99,235,0.1), transparent 75%)'
        }}
      />
      {/* scale the fixed 480px coordinate system to the responsive box */}
      <div
        className="absolute inset-0"
        style={{ transform: 'scale(var(--const-scale, 1))', transformOrigin: 'top left' }}
      >
        <div className="relative" style={{ width: size, height: size }}>
          <OrbitRing
            members={outer}
            radius={206}
            center={center}
            size={size}
            spinClass="fx-spin-slow-rev"
            counterClass="fx-counter-spin-rev"
            reduce={reduce}
          />
          <OrbitRing
            members={inner}
            radius={128}
            center={center}
            size={size}
            spinClass="fx-spin-slow"
            counterClass="fx-counter-spin"
            reduce={reduce}
          />
          {/* center — Earn */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative">
              <div
                className="fx-glow-pulse pointer-events-none absolute inset-0 -z-10 blur-2xl"
                style={{
                  background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 65%)'
                }}
              />
              <EarnCoin size={88} glow online className="fx-coin-float" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecialistCard({ member }: { member: TeamMember }) {
  return (
    <Card clickable className="flex h-full items-start gap-4 p-5">
      <TeamAvatar member={member} size={48} variant="disc" className="flex-none" />
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold leading-tight text-fg-1">{member.name}</h3>
        <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gold-1">
          {member.position}
        </p>
        <p className="mt-2 text-[11.5px] leading-5 text-fg-3">{member.oneLiner}</p>
      </div>
    </Card>
  );
}

/** How many specialist cards show before the "Show all" expansion. */
const COLLAPSED_COUNT = 6;

export function TeamConstellation() {
  const reduce = useReducedMotion();
  const earn = getCOO();
  const specialists = getSpecialists();
  // Fifteen cards make a very long scroll (especially on mobile, where they
  // stack one-up and push the closing CTA far down) — collapse to the first
  // six with an accessible "Show all" toggle. All content stays reachable.
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? specialists : specialists.slice(0, COLLAPSED_COUNT);

  return (
    <section id="team" className="py-16 sm:py-24" aria-labelledby="team-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
              The Team
            </p>
            <h2
              id="team-heading"
              className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
            >
              Fifteen specialists. One relentless desk.
            </h2>
            <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
              Earn leads fourteen specialists across capital formation, sourcing, diligence,
              packaging, and closing — each carrying your mandate, every action on the record.
              It&rsquo;s the team a billion-dollar firm would hire. You get it on day one.
            </p>

            {/* Earn spotlight */}
            <Card className="relative mt-7 overflow-hidden p-5">
              <div
                className="pointer-events-none absolute inset-0 -z-10"
                style={{
                  background:
                    'radial-gradient(70% 130% at 0% 0%, rgba(247,201,72,0.1), transparent 60%)'
                }}
                aria-hidden
              />
              <div className="flex items-center gap-4">
                <TeamAvatar member={earn} size={56} glow online className="flex-none" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-1">
                    {earn.position} · live AI guide
                  </p>
                  <h3 className="mt-0.5 text-lg font-semibold text-fg-1">
                    {earn.name} &ldquo;Earn&rdquo;
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-5 text-fg-3">{earn.oneLiner}</p>
                </div>
              </div>
            </Card>
          </Reveal>

          <Reveal delay={0.1}>
            <Constellation reduce={reduce} />
          </Reveal>
        </div>

        {/* Accessible specialist grid — collapsed to six until expanded */}
        <div id="specialists-grid">
          <Stagger
            key={showAll ? 'all' : 'collapsed'}
            className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {visible.map((m) => (
              <StaggerItem key={m.slug} className="h-full">
                <SpecialistCard member={m} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
        {specialists.length > COLLAPSED_COUNT && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              aria-controls="specialists-grid"
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-5 py-2.5 text-[13px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              {showAll ? 'Show fewer' : `Show all ${specialists.length} specialists`}
              <ChevronDown
                size={15}
                strokeWidth={1.9}
                aria-hidden
                className={showAll ? 'rotate-180 transition-transform' : 'transition-transform'}
              />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export default TeamConstellation;
