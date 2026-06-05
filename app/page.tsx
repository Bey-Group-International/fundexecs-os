import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Rocket,
  Coins,
  Users,
  Search,
  Database,
  Share2,
  FileText,
  BarChart3,
  Package,
  MessageSquare,
  CheckCircle2,
  type LucideIcon
} from 'lucide-react';
import { Badge, Card } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { LandingNav } from '@/components/landing/LandingNav';
import { SmoothScrollLink } from '@/components/landing/SmoothScrollLink';
import { ActivityTicker } from '@/components/landing/ActivityTicker';
import { HeroStats } from '@/components/landing/HeroStats';

export const metadata: Metadata = {
  title: 'AI Copilots for the Full Capital Lifecycle',
  description:
    'FundExecs is a suite of AI copilots that operate the full capital lifecycle — capital formation, sourcing, diligence, packaging, and closing — for fund managers and dealmakers.'
};

// ── Shared CTA styles (match the app's institutional-blue primary) ───────────

const PRIMARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-5 py-3 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const PRIMARY_CTA_SM =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2 text-[12.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const SECONDARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-1 px-5 py-3 text-sm font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1';

// ── Copilots — 11 capabilities grouped into 4 lifecycle clusters ─────────────

interface Copilot {
  icon: LucideIcon;
  /** The copilot's name (a named specialist on the desk). */
  name: string;
  /** The function it owns. */
  title: string;
  body: string;
}

interface Cluster {
  label: string;
  copilots: Copilot[];
}

const CLUSTERS: Cluster[] = [
  {
    label: 'Raise',
    copilots: [
      {
        icon: Rocket,
        name: 'Atlas',
        title: 'Fund Launches',
        body: 'Stand up a fund with discipline — entity structure, investment thesis, and core materials, assembled to institutional standard.'
      },
      {
        icon: Coins,
        name: 'Rainmaker',
        title: 'Capital Raises',
        body: 'Run a structured raise: target suitable capital, document every conversation, and sustain momentum through final close.'
      },
      {
        icon: Users,
        name: 'Envoy',
        title: 'Partner Prospecting',
        body: 'Identify and qualify LPs, co-investors, and operating partners against your mandate — and establish a credible path to each.'
      }
    ]
  },
  {
    label: 'Source',
    copilots: [
      {
        icon: Search,
        name: 'Scout',
        title: 'Deal Sourcing',
        body: 'Surface proprietary, on-thesis opportunities ahead of the broader market.'
      },
      {
        icon: Database,
        name: 'Oracle',
        title: 'Data Scouring',
        body: 'Extract signal from filings, registries, and public sources — reconciled into a clean, decision-ready record.'
      },
      {
        icon: Share2,
        name: 'Nexus',
        title: 'Relationship Aggregating',
        body: 'Consolidate your firm’s relationships into a single graph — and surface the shortest credible path to any counterparty.'
      }
    ]
  },
  {
    label: 'Analyze & Package',
    copilots: [
      {
        icon: FileText,
        name: 'Scribe',
        title: 'Document Drafting',
        body: 'Draft memoranda, presentations, and agreements to the standard your investment committee expects.'
      },
      {
        icon: BarChart3,
        name: 'Auditor',
        title: 'Deal Analyzing',
        body: 'Pressure-test the model, comparables, and risks with investment-committee rigor.'
      },
      {
        icon: Package,
        name: 'Curator',
        title: 'Deal Packaging',
        body: 'Assemble an institutional-grade package — data room, narrative, and terms in lockstep.'
      }
    ]
  },
  {
    label: 'Close',
    copilots: [
      {
        icon: MessageSquare,
        name: 'Liaison',
        title: 'Communicating',
        body: 'Keep every counterparty informed and every workstream advancing — measured, timely, and on the record.'
      },
      {
        icon: CheckCircle2,
        name: 'Closer',
        title: 'Closing',
        body: 'Drive to signature — track conditions precedent, coordinate signatories, and close cleanly.'
      }
    ]
  }
];

interface Step {
  n: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    n: '01',
    title: 'Define the mandate',
    body: 'Set your thesis, targets, and constraints with Earnest. Every copilot aligns to the mandate from the outset.'
  },
  {
    n: '02',
    title: 'Source & raise',
    body: 'Surface opportunities and capital, qualified through your relationships and verified data.'
  },
  {
    n: '03',
    title: 'Analyze & package',
    body: 'Pressure-test the opportunity and assemble an institutional-grade package — documents and narrative in lockstep.'
  },
  {
    n: '04',
    title: 'Communicate & close',
    body: 'Advance every counterparty and drive to signature — coordinated, documented, and accountable.'
  }
];

// Chain of Trust — the 4-layer proof chain (colors from the design tokens).
interface TrustLayer {
  name: string;
  color: string;
  body: string;
}

const TRUST_LAYERS: TrustLayer[] = [
  {
    name: 'Proof of Truth',
    color: 'var(--proof-truth)',
    body: 'Source data, citations, and verified facts.'
  },
  {
    name: 'Proof of Concept',
    color: 'var(--proof-concept)',
    body: 'Strategy, thesis, and fit logic.'
  },
  {
    name: 'Proof of Execution',
    color: 'var(--proof-execution)',
    body: 'Tasks, workflows, and approvals.'
  },
  {
    name: 'Proof of Work',
    color: 'var(--proof-work)',
    body: 'Evidence, uploads, outcomes, and logs.'
  }
];

// ── Sections ─────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section
      className="relative overflow-hidden pb-20 pt-32 sm:pb-28 sm:pt-40"
      aria-labelledby="hero-heading"
    >
      {/* Dark gradient background + tasteful gold glow. */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 70% 20%, rgba(247,201,72,0.14), transparent 70%), radial-gradient(50% 50% at 20% 80%, rgba(37,99,235,0.12), transparent 70%), linear-gradient(180deg, var(--bg-0) 0%, var(--bg-1) 100%)'
        }}
        aria-hidden
      />
      <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Badge tone="gold" dot pulse className="mb-6">
            Led by Earnest, your live AI guide
          </Badge>

          <h1
            id="hero-heading"
            className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-fg-1 sm:text-5xl lg:text-6xl"
          >
            Unified intelligence layer for the <span className="text-gold-1">private markets.</span>
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-fg-3 sm:text-lg">
            Twelve AI copilots working as one to optimize workflows, accelerate decisions, and
            elevate your capacity to execute like an institution.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link href="/login" className={PRIMARY_CTA}>
              Get started
              <ArrowRight size={16} strokeWidth={1.9} aria-hidden />
            </Link>
            <SmoothScrollLink targetId="copilots" className={SECONDARY_CTA}>
              See how it works
            </SmoothScrollLink>
          </div>

          {/* Live proof points — animated count-ups in an elevated strip. */}
          <HeroStats />
        </div>

        {/* Hero mascot with gentle float + gold glow. */}
        <div className="flex justify-center lg:col-span-5 lg:justify-end">
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
              className="fx-coin-float h-44 w-44 sm:h-56 sm:w-56 lg:h-72 lg:w-72"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function CopilotCard({ copilot }: { copilot: Copilot }) {
  const Icon = copilot.icon;
  return (
    <Card clickable className="flex h-full flex-col p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
          <Icon size={15} strokeWidth={1.9} aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[13.5px] font-semibold leading-tight text-fg-1">
            {copilot.name}
          </h3>
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-gold-1">
            {copilot.title}
          </p>
        </div>
      </div>
      <p className="mt-2.5 text-[11.5px] leading-5 text-fg-3">{copilot.body}</p>
    </Card>
  );
}

function Copilots() {
  return (
    <section id="copilots" className="py-20 sm:py-28" aria-labelledby="copilots-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            The Copilots
          </p>
          <h2
            id="copilots-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            Eleven specialists. One orchestrator. One lifecycle.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            Each copilot owns a stage of the work; Earnest leads the eleven as one — carrying a
            mandate from first thesis to signed close, coordinated, documented, and fully auditable.
          </p>
        </div>

        {/* Earnest — the orchestrator; the first of the twelve. */}
        <div className="mt-12">
          <Card className="relative overflow-hidden p-6 sm:p-7">
            <div
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background:
                  'radial-gradient(70% 130% at 0% 0%, rgba(247,201,72,0.1), transparent 60%)'
              }}
              aria-hidden
            />
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <EarnCoin size={72} glow online className="flex-none" />
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-1">
                  Orchestrator · live AI guide
                </p>
                <h3 className="mt-1 text-xl font-semibold text-fg-1">Earnest</h3>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-fg-3">
                  Earnest fronts the desk and runs the eleven specialists as one — routing each
                  task, framing the next decision, and keeping every mandate moving from first
                  thesis to signed close.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="mt-10 space-y-12">
          {CLUSTERS.map((cluster) => (
            <div key={cluster.label}>
              <div className="mb-6 flex items-center gap-3">
                <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gold-1">
                  {cluster.label}
                </span>
                <span className="h-px flex-1 bg-hairline" aria-hidden />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cluster.copilots.map((c) => (
                  <CopilotCard key={c.title} copilot={c} />
                ))}
              </div>
              <div className="mt-6">
                <Link href="/login" className={PRIMARY_CTA_SM}>
                  Get started
                  <ArrowRight size={14} strokeWidth={1.9} aria-hidden />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ChainOfTrust() {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="trust-heading">
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

        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_LAYERS.map((layer, i) => (
            <li key={layer.name}>
              <Card className="h-full p-6">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: layer.color, boxShadow: `0 0 12px ${layer.color}` }}
                    aria-hidden
                  />
                  <span className="text-[11px] font-semibold tabular-nums text-fg-4">
                    {`0${i + 1}`}
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

function MeetEarnest() {
  return (
    <section
      className="border-y border-hairline py-20 sm:py-24"
      style={{
        background:
          'radial-gradient(60% 80% at 80% 50%, rgba(247,201,72,0.08), transparent 70%), var(--bg-1)'
      }}
      aria-labelledby="earnest-heading"
    >
      <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            Meet Earnest
          </p>
          <h2
            id="earnest-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl"
          >
            A live guide with command of the entire lifecycle.
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-7 text-fg-3 sm:text-lg">
            Earnest fronts the copilots — answering questions, framing the next decision, and
            routing each task to the right specialist. Measured, candid, and always on the record.
            The full engagement continues inside the platform.
          </p>
          <div className="mt-8">
            <Link href="/login" className={PRIMARY_CTA}>
              Get started
              <ArrowRight size={16} strokeWidth={1.9} aria-hidden />
            </Link>
          </div>
        </div>
        <div className="flex justify-center lg:col-span-5 lg:justify-end">
          <EarnCoin size={224} glow online className="h-40 w-40 sm:h-52 sm:w-52" />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="how-heading">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <div className="mb-14 max-w-2xl">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold-1">
            How it works
          </p>
          <h2
            id="how-heading"
            className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-fg-1 sm:text-4xl lg:text-5xl"
          >
            Four steps from thesis to signed close.
          </h2>
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
      className="py-20 sm:py-28"
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
          Bring Earnest and the copilots into your next raise, transaction, or close.
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
              AI copilots for the full capital lifecycle — capital formation, sourcing, diligence,
              packaging, and closing.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-10 gap-y-3" aria-label="Footer">
            <SmoothScrollLink
              targetId="copilots"
              className="rounded-md text-[13px] text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              Copilots
            </SmoothScrollLink>
            <SmoothScrollLink
              targetId="how-heading"
              className="rounded-md text-[13px] text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
            >
              How it works
            </SmoothScrollLink>
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
      {/* Skip link for keyboard / screen-reader users. */}
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
        <Copilots />
        <ChainOfTrust />
        <MeetEarnest />
        <HowItWorks />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
