'use client';

import Link from 'next/link';
import { ArrowRight, Gauge, ShieldCheck, Radar, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { Reveal, Stagger, StaggerItem, Magnetic } from '@/components/landing/Motion';
import { PRIMARY_CTA } from '@/components/landing/cta';

/* ============================================================================
 * components/landing/Sections.tsx — the animated content sections below the
 * hero/preview: ValueProps (the case), ChainOfTrust (credibility), HowItWorks
 * (process), and the FinalCta. All scroll-revealed; all reduced-motion safe.
 * ========================================================================= */

const EASE = [0.22, 0.61, 0.36, 1] as const;

// ── Value propositions ───────────────────────────────────────────────────────

interface ValueProp {
  icon: LucideIcon;
  metric: string;
  title: string;
  body: string;
}

const VALUE_PROPS: ValueProp[] = [
  {
    icon: Gauge,
    metric: '10×',
    title: 'The output, none of the headcount',
    body: 'A fifteen-person deal team that never sleeps, never forgets, and bills you nothing in salary. Ship in a day what used to take a quarter.'
  },
  {
    icon: Radar,
    metric: '0',
    title: 'Opportunities slip through',
    body: 'Every lead, LP, obligation, and follow-up tracked and chased automatically. The deal you would have lost is the one Earn just closed.'
  },
  {
    icon: ShieldCheck,
    metric: '100%',
    title: 'Provable, audit-ready rigor',
    body: 'Institutional diligence behind every decision, traced to source and signed. Walk into any IC or LP meeting with the receipts already in hand.'
  }
];

export function ValueProps() {
  return (
    <section className="py-16 sm:py-24" aria-labelledby="value-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal className="mb-12 max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            Why FundExecs
          </p>
          <h2
            id="value-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            The unfair advantage your competitors don&rsquo;t have yet.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            Capital moves to whoever is fastest, sharpest, and most prepared. FundExecs makes that
            you — overnight.
          </p>
        </Reveal>

        <Stagger className="grid gap-5 md:grid-cols-3">
          {VALUE_PROPS.map((v) => {
            const Icon = v.icon;
            return (
              <StaggerItem key={v.title} className="h-full">
                <Card className="group relative h-full overflow-hidden p-6">
                  <div
                    className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(247,201,72,0.12),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    aria-hidden
                  />
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
                      <Icon size={20} strokeWidth={1.9} aria-hidden />
                    </span>
                    <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-fg-1">
                      {v.metric}
                    </span>
                  </div>
                  <h3 className="mt-5 text-[16px] font-semibold leading-snug text-fg-1">
                    {v.title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-6 text-fg-3">{v.body}</p>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>
    </section>
  );
}

// ── Chain of Trust ───────────────────────────────────────────────────────────

const TRUST_LAYERS = [
  {
    name: 'Proof of Truth',
    color: 'var(--proof-truth)',
    body: 'Every claim traced to source data, citations, and verified facts — nothing asserted that cannot be shown.'
  },
  {
    name: 'Proof of Concept',
    color: 'var(--proof-concept)',
    body: 'The strategy, thesis, and fit logic behind each decision, documented as it forms.'
  },
  {
    name: 'Proof of Execution',
    color: 'var(--proof-execution)',
    body: 'The tasks, workflows, and approvals that moved it forward — who did what, and when.'
  },
  {
    name: 'Proof of Work',
    color: 'var(--proof-work)',
    body: 'Signed evidence, uploads, and outcomes — the auditable record of work delivered.'
  }
];

export function ChainOfTrust() {
  const reduce = useReducedMotion();
  return (
    <section className="py-16 sm:py-24" aria-labelledby="trust-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            Chain of Trust
          </p>
          <h2
            id="trust-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            AI you can actually put your name behind.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            Every outcome rests on a four-layer proof chain — from source data to signed evidence.
            Nothing is asserted that cannot be shown. This is how AI earns a seat at an
            institutional desk.
          </p>
        </Reveal>

        <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_LAYERS.map((layer, i) => (
            <StaggerItem key={layer.name} className="h-full">
              <Card className="h-full p-6">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: layer.color, boxShadow: `0 0 12px ${layer.color}` }}
                    aria-hidden
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] tabular-nums text-fg-4">
                    {`Layer 0${i + 1}`}
                  </span>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-fg-1">{layer.name}</h3>
                <p className="mt-1.5 text-[12.5px] leading-6 text-fg-3">{layer.body}</p>
                <div className="mt-5 h-1 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${layer.color}, transparent)`,
                      transformOrigin: 'left'
                    }}
                    initial={reduce ? false : { scaleX: 0 }}
                    whileInView={reduce ? undefined : { scaleX: 1 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 0.7, ease: EASE, delay: 0.1 * i }}
                  />
                </div>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: '01',
    title: 'Set the mandate',
    body: 'Tell Earn your thesis, targets, and constraints. In minutes, the whole team is aligned and working.'
  },
  {
    n: '02',
    title: 'Source & raise',
    body: 'On-thesis deals and the right capital — surfaced through your relationships, verified against primary data.'
  },
  {
    n: '03',
    title: 'Analyze & package',
    body: 'Committee-grade pressure-testing and an institutional package — model, narrative, and terms in lockstep.'
  },
  {
    n: '04',
    title: 'Communicate & close',
    body: 'Every counterparty advanced and driven to signature — coordinated, documented, accountable.'
  }
];

export function HowItWorks() {
  const reduce = useReducedMotion();
  return (
    <section className="py-16 sm:py-24" aria-labelledby="how-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <Reveal className="mb-10 max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            How it works
          </p>
          <h2
            id="how-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            From thesis to signed close — on one desk.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            One disciplined operating model, run by your team and recorded end to end, so every
            engagement compounds into a track record you own.
          </p>
        </Reveal>

        <div className="relative">
          {/* connecting line that draws on scroll (lg+) */}
          <div
            className="pointer-events-none absolute left-0 right-0 top-[34px] hidden h-px bg-hairline lg:block"
            aria-hidden
          >
            <motion.div
              className="h-full origin-left bg-[linear-gradient(90deg,var(--gold-1),transparent)]"
              initial={reduce ? false : { scaleX: 0 }}
              whileInView={reduce ? undefined : { scaleX: 1 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 1.1, ease: EASE }}
            />
          </div>

          <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <StaggerItem key={s.n} className="h-full">
                <Card className="h-full p-6">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--gold-line)] bg-bg-1 text-[15px] font-semibold tabular-nums text-gold-1">
                    {s.n}
                  </div>
                  <h3 className="mt-4 text-[15px] font-semibold text-fg-1">{s.title}</h3>
                  <p className="mt-1.5 text-[12.5px] leading-6 text-fg-3">{s.body}</p>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}

// ── Final CTA ────────────────────────────────────────────────────────────────

export function FinalCta() {
  return (
    <section
      className="relative overflow-hidden py-20 sm:py-28"
      style={{
        background:
          'radial-gradient(70% 120% at 50% 0%, rgba(247,201,72,0.14), transparent 70%), var(--bg-0)'
      }}
      aria-labelledby="cta-heading"
    >
      <div
        className="fx-aurora pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          background:
            'radial-gradient(40% 50% at 20% 30%, rgba(37,99,235,0.12), transparent 70%), radial-gradient(40% 50% at 80% 60%, rgba(247,201,72,0.12), transparent 70%)'
        }}
        aria-hidden
      />
      <Reveal className="mx-auto max-w-3xl px-5 text-center sm:px-8">
        <EarnCoin size={68} glow online className="fx-coin-float mx-auto" />
        <h2
          id="cta-heading"
          className="mt-7 text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-[52px]"
        >
          Your next raise is happening with or without you.
        </h2>
        <p className="mt-5 text-[16px] leading-7 text-fg-3 sm:text-lg">
          Bring Earn and your AI executive team into your next deal — and operate like the biggest
          firm in the room. The only mistake is watching someone else do it first.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Magnetic>
            <Link href="/login" className={PRIMARY_CTA}>
              Claim your desk
              <ArrowRight size={17} strokeWidth={2} aria-hidden />
            </Link>
          </Magnetic>
          <span className="text-[12.5px] text-fg-5">
            Invite-only beta · no card, no setup, no risk
          </span>
        </div>
      </Reveal>
    </section>
  );
}
