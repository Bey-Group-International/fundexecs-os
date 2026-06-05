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

export const metadata: Metadata = {
  title: 'AI Copilots for the Full Capital Lifecycle',
  description:
    'FundExecs is a suite of AI copilots that run the entire capital lifecycle — raise, source, package, and close — for fund builders and dealmakers.'
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
        title: 'Fund Launches',
        body: 'Stand up a fund — structure, thesis, and materials — with a copilot that has launched the playbook before.'
      },
      {
        icon: Coins,
        title: 'Capital Raises',
        body: 'Run a disciplined raise: target the right capital, track every conversation, and keep momentum to the wire.'
      },
      {
        icon: Users,
        title: 'Partner Prospecting',
        body: 'Identify and qualify LPs, co-investors, and operating partners worth your time — and warm the path to them.'
      }
    ]
  },
  {
    label: 'Source',
    copilots: [
      {
        icon: Search,
        title: 'Deal Sourcing',
        body: 'Surface proprietary, on-thesis opportunities before they hit the broad market.'
      },
      {
        icon: Database,
        title: 'Data Scouring',
        body: 'Pull signal from filings, registries, and the open web — assembled into a clean, decision-ready picture.'
      },
      {
        icon: Share2,
        title: 'Relationship Aggregating',
        body: "Map your network and your team's into one living graph — and find the shortest credible path to anyone."
      }
    ]
  },
  {
    label: 'Analyze & Package',
    copilots: [
      {
        icon: FileText,
        title: 'Document Drafting',
        body: 'Generate memos, decks, and agreements that read like they came from your best associate.'
      },
      {
        icon: BarChart3,
        title: 'Deal Analyzing',
        body: 'Pressure-test the model, the comps, and the risks — with the rigor of an investment committee.'
      },
      {
        icon: Package,
        title: 'Deal Packaging',
        body: 'Assemble a polished, investor-ready package — data room, narrative, and terms in lockstep.'
      }
    ]
  },
  {
    label: 'Close',
    copilots: [
      {
        icon: MessageSquare,
        title: 'Communicating',
        body: 'Keep every counterparty informed and every thread moving — with the right tone, at the right moment.'
      },
      {
        icon: CheckCircle2,
        title: 'Closing',
        body: 'Drive to signature: track conditions, coordinate signers, and land the close cleanly.'
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
    title: 'Set the mandate',
    body: 'Tell Earnest your thesis, targets, and constraints. The copilots align to it from the first move.'
  },
  {
    n: '02',
    title: 'Source & raise',
    body: 'Surface opportunities and capital, warmed through your real relationships and clean data.'
  },
  {
    n: '03',
    title: 'Analyze & package',
    body: 'Pressure-test the deal and assemble an investor-ready package — documents and narrative in lockstep.'
  },
  {
    n: '04',
    title: 'Communicate & close',
    body: 'Keep every counterparty moving and drive to signature — coordinated, documented, accountable.'
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
            Guided by Earnest, your live AI guide
          </Badge>

          <h1
            id="hero-heading"
            className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-fg-1 sm:text-5xl lg:text-6xl"
          >
            AI Copilots for the <span className="text-gold-1">full capital lifecycle.</span>
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-fg-3 sm:text-lg">
            FundExecs runs the work behind every raise, source, package, and close — so fund
            builders and dealmakers move with the precision of a far larger firm.
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

          {/* Live stat row. */}
          <dl className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-hairline pt-8 text-[12px] text-fg-4 [font-feature-settings:'tnum']">
            <div>
              <dt className="sr-only">Capital tracked</dt>
              <dd>
                <span className="font-semibold text-fg-2">$612M+</span> capital tracked
              </dd>
            </div>
            <div>
              <dt className="sr-only">Relationships</dt>
              <dd>
                <span className="font-semibold text-fg-2">500+</span> relationships
              </dd>
            </div>
            <div>
              <dt className="sr-only">Chain of Trust</dt>
              <dd>
                <span className="font-semibold text-fg-2">4-layer</span> Chain of Trust
              </dd>
            </div>
            <div>
              <dt className="sr-only">AI brains</dt>
              <dd>
                <span className="font-semibold text-fg-2">15</span> AI brains
              </dd>
            </div>
          </dl>
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
    <Card clickable className="p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-fg-1">{copilot.title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-6 text-fg-3">{copilot.body}</p>
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
            Eleven copilots. One continuous capital lifecycle.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
            Each copilot owns a stage of the work. Together they carry a deal from first thesis to
            signed close — coordinated, documented, and accountable.
          </p>
        </div>

        <div className="mt-14 space-y-14">
          {CLUSTERS.map((cluster) => (
            <div key={cluster.label}>
              <div className="mb-6 flex items-center gap-3">
                <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gold-1">
                  {cluster.label}
                </span>
                <span className="h-px flex-1 bg-hairline" aria-hidden />
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
            A live guide who knows the whole lifecycle.
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-7 text-fg-3 sm:text-lg">
            Earnest fronts the copilots — answering questions, framing the next move, and routing
            your work to the right specialist. Steady, candid, and always on the record. The full
            conversation continues inside the platform.
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
          Run your capital lifecycle like a far larger firm.
        </h2>
        <p className="mt-5 text-[15px] leading-7 text-fg-3 sm:text-lg">
          Bring Earnest and the copilots into your next raise, deal, or close.
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
                FundExecs
              </span>
            </div>
            <p className="text-[12.5px] leading-6 text-fg-4">
              AI copilots for the full capital lifecycle — raise, source, package, and close.
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
            © 2026 FundExecs. All rights reserved. Not an offer or solicitation.
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
        <MeetEarnest />
        <HowItWorks />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
