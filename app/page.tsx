import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { LandingNav } from '@/components/landing/LandingNav';
import { SmoothScrollLink } from '@/components/landing/SmoothScrollLink';
import { ActivityTicker } from '@/components/landing/ActivityTicker';
import { HeroStats } from '@/components/landing/HeroStats';
import { TeamAvatar, getCOO, getSpecialists } from '@/lib/team';

export const metadata: Metadata = {
  title: 'An AI executive team for the full capital lifecycle',
  description:
    'FundExecs is an AI executive team — fifteen specialists led by Earnest Fundmaker, the Chief Operating Officer — that operates the full capital lifecycle for fund managers and dealmakers.'
};

// ── Shared CTA styles (match the app's institutional-blue primary) ───────────

const PRIMARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-5 py-3 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SECONDARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-1 px-5 py-3 text-sm font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1';

interface Step {
  n: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Set the mandate',
    body: 'Define your thesis, targets, and constraints with Earn. The whole team aligns to that mandate from the outset.'
  },
  {
    n: '02',
    title: 'Source & raise',
    body: 'Surface on-thesis opportunities and suitable capital — qualified through your relationships and verified against primary data.'
  },
  {
    n: '03',
    title: 'Analyze & package',
    body: 'Pressure-test the opportunity with committee rigor and assemble an institutional-grade package — model, narrative, and terms in lockstep.'
  },
  {
    n: '04',
    title: 'Communicate & close',
    body: 'Advance every counterparty and drive to signature — coordinated, documented, and accountable at every step.'
  }
];

interface TrustLayer {
  name: string;
  color: string;
  body: string;
}

const TRUST_LAYERS: TrustLayer[] = [
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

// ── Sections ─────────────────────────────────────────────────────────────────

function Hero() {
  const earn = getCOO();
  return (
    <section
      className="relative overflow-hidden pb-16 pt-28 sm:pb-20 sm:pt-32"
      aria-labelledby="hero-heading"
    >
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 70% 20%, rgba(247,201,72,0.14), transparent 70%), radial-gradient(50% 50% at 20% 80%, rgba(37,99,235,0.12), transparent 70%), linear-gradient(180deg, var(--bg-0) 0%, var(--bg-1) 100%)'
        }}
        aria-hidden
      />
      <div className="mx-auto grid max-w-[1180px] items-center gap-8 px-5 sm:px-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <Badge tone="gold" dot pulse className="mb-6">
            Led by Earn, your live AI guide
          </Badge>

          <h1
            id="hero-heading"
            className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-fg-1 sm:text-5xl lg:text-6xl"
          >
            Unified intelligence layer for the <span className="text-gold-1">private markets.</span>
          </h1>

          <p className="mt-5 max-w-xl text-[16px] leading-7 text-fg-3 sm:text-[17px]">
            A fifteen-strong executive team — led by Earn — working as one to optimize your
            workflows, accelerate your decisions, and elevate your capacity to execute like an
            institution.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link href="/login" className={PRIMARY_CTA}>
              Get started
              <ArrowRight size={16} strokeWidth={1.9} aria-hidden />
            </Link>
            <SmoothScrollLink targetId="team" className={SECONDARY_CTA}>
              Meet the team
            </SmoothScrollLink>
          </div>

          <p className="mt-4 text-[12px] text-fg-5">
            FundExecs OS is currently in <span className="text-fg-3">invite-only private beta</span>
            .
          </p>

          <HeroStats />
        </div>

        {/* Hero mascot — EarnCoin with gold glow + identity caption. */}
        <div className="flex flex-col items-center lg:col-span-5 lg:items-end">
          <div className="relative">
            <div
              className="fx-glow-pulse pointer-events-none absolute inset-0 -z-10"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.4), transparent 65%)',
                filter: 'blur(40px)'
              }}
              aria-hidden
            />
            <EarnCoin
              size={300}
              glow
              online
              className="fx-coin-float h-44 w-44 sm:h-56 sm:w-56 lg:h-72 lg:w-72"
            />
          </div>
          <div className="mt-6 text-center lg:text-right">
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

function CooSpotlight() {
  const earn = getCOO();
  return (
    <Card className="relative overflow-hidden p-6 sm:p-7">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: 'radial-gradient(70% 130% at 0% 0%, rgba(247,201,72,0.1), transparent 60%)'
        }}
        aria-hidden
      />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <TeamAvatar member={earn} size={72} glow online className="flex-none" />
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-1">
            {earn.position} · live AI guide
          </p>
          <h3 className="mt-1 text-xl font-semibold text-fg-1">{earn.name} &ldquo;Earn&rdquo;</h3>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-fg-3">{earn.oneLiner}</p>
        </div>
      </div>
    </Card>
  );
}

function SpecialistCard({ slug }: { slug: string }) {
  const member = getSpecialists().find((m) => m.slug === slug);
  if (!member) return null;
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

function Team() {
  const specialists = getSpecialists();
  return (
    <section id="team" className="py-14 sm:py-20" aria-labelledby="team-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            The Team
          </p>
          <h2
            id="team-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            Your executive team. Fifteen specialists, one desk.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            An institutional-grade desk that works as one — Earnest leads fourteen specialists
            across capital formation, sourcing, diligence, packaging, and closing. Each carries your
            mandate; every action is documented and on the record.
          </p>
        </div>

        {/* Earnest — the COO; the first of the fifteen. */}
        <div className="mt-8">
          <CooSpotlight />
        </div>

        {/* The fourteen specialists. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {specialists.map((m) => (
            <SpecialistCard key={m.slug} slug={m.slug} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ChainOfTrust() {
  return (
    <section className="py-14 sm:py-20" aria-labelledby="trust-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            Chain of Trust
          </p>
          <h2
            id="trust-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            Every outcome, proven in four layers.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            FundExecs OS records the work as it happens, so every result rests on an auditable proof
            chain — from source data to signed evidence. Nothing is asserted that cannot be shown.
          </p>
        </div>

        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_LAYERS.map((layer, i) => (
            <li key={layer.name}>
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
                <div
                  className="mt-5 h-1 rounded-full"
                  style={{ background: `linear-gradient(90deg, ${layer.color}, transparent)` }}
                  aria-hidden
                />
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="py-14 sm:py-20" aria-labelledby="how-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="mb-10 max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            How it works
          </p>
          <h2
            id="how-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            Four steps from thesis to signed close.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            One disciplined operating model — run by your team and recorded end to end, so every
            engagement compounds into an auditable track record.
          </p>
        </div>
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n}>
              <Card className="h-full p-6">
                <div className="text-2xl font-semibold tabular-nums text-gold-1">{s.n}</div>
                <h3 className="mt-3 text-[15px] font-semibold text-fg-1">{s.title}</h3>
                <p className="mt-1.5 text-[12.5px] leading-6 text-fg-3">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section
      className="py-14 sm:py-20"
      style={{
        background:
          'radial-gradient(70% 120% at 50% 0%, rgba(247,201,72,0.12), transparent 70%), var(--bg-0)'
      }}
      aria-labelledby="cta-heading"
    >
      <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
        <EarnCoin size={60} glow className="mx-auto" />
        <h2
          id="cta-heading"
          className="mt-6 text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
        >
          Operate your capital lifecycle like a far larger institution.
        </h2>
        <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
          Bring Earn and your executive team into your next raise, transaction, or close.
        </p>
        <div className="mt-9 flex justify-center">
          <Link href="/login" className={PRIMARY_CTA}>
            Get started
            <ArrowRight size={16} strokeWidth={1.9} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-hairline bg-bg-1 py-14">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="mb-4 flex items-center gap-2.5">
              <EarnCoin size={24} />
              <span className="text-base font-semibold tracking-[-0.02em] text-fg-1">
                FundExecs <span className="font-medium text-fg-4">OS</span>
              </span>
            </div>
            <p className="text-[12.5px] leading-6 text-fg-4">
              An AI executive team for the full capital lifecycle — capital formation, sourcing,
              diligence, packaging, and closing.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-10 gap-y-3" aria-label="Footer">
            <SmoothScrollLink
              targetId="team"
              className="rounded-md text-[13px] text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              The Team
            </SmoothScrollLink>
            <SmoothScrollLink
              targetId="how-heading"
              className="rounded-md text-[13px] text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              How it works
            </SmoothScrollLink>
            <Link
              href="/privacy"
              className="rounded-md text-[13px] text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="rounded-md text-[13px] text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              Terms
            </Link>
            <Link
              href="/login"
              className="rounded-md text-[13px] text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="rounded-md text-[13px] text-gold-1 transition hover:text-gold-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              Get started
            </Link>
          </nav>
        </div>

        <div className="mt-12 space-y-3 border-t border-hairline pt-8">
          <p className="max-w-3xl text-[11.5px] leading-relaxed text-fg-5">
            Activity shown on this page is anonymized for confidentiality and is presented to
            illustrate platform momentum. It is not an offer or solicitation.
          </p>
          <p className="text-[11.5px] text-fg-5">
            FundExecs OS by FundExecs Technologies · © 2026 FundExecs Technologies. All rights
            reserved. Not an offer or solicitation.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg-0 text-fg-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-xl focus:bg-gold-1 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#070b14]"
      >
        Skip to content
      </a>

      <LandingNav />

      <main id="main">
        <Hero />
        <ActivityTicker />
        <Team />
        <ChainOfTrust />
        <HowItWorks />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
