import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ShieldCheck,
  Workflow,
  ScanSearch,
  Briefcase,
  CloudRain,
  Radar,
  Link2,
  Scale,
  Megaphone,
  Search,
  Filter,
  Ticket,
  Users,
  Landmark,
  GraduationCap,
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

const SECONDARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-hairline bg-surface-1 px-5 py-3 text-sm font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1';

// ── The Team — Earnest + fourteen specialists (the 15 Earn brains) ───────────

interface TeamMember {
  icon: LucideIcon;
  /** The member's name on your executive desk. */
  name: string;
  /** Their position / title. */
  position: string;
  /** What they do for you. */
  body: string;
}

// Fourteen specialists; Earnest, the lead, is featured separately above.
const TEAM: TeamMember[] = [
  {
    icon: Workflow,
    name: 'Sterling',
    position: 'Chief of Staff',
    body: 'Owns your operating rhythm — intakes every request, sequences the work across the desk, and makes sure nothing falls between functions.'
  },
  {
    icon: ScanSearch,
    name: 'Dalia',
    position: 'Head of Data Operations',
    body: 'Cleans and structures everything inbound — reconciling data into a single, decision-ready record you can act on.'
  },
  {
    icon: Briefcase,
    name: 'Theodore',
    position: 'Chief Strategy Advisor',
    body: 'Your sounding board on every consequential call — pressure-tests strategy, frames the trade-offs, and grounds each decision in the institutional playbook.'
  },
  {
    icon: CloudRain,
    name: 'Vivian',
    position: 'Managing Director, Demand Generation',
    body: 'Builds and sustains your pipeline of interest — generating qualified demand and holding momentum from first touch to commitment.'
  },
  {
    icon: Radar,
    name: 'Marcus',
    position: 'Head of Deal Origination',
    body: 'Surfaces proprietary, on-thesis opportunities ahead of the market — scored against your mandate before they reach your desk.'
  },
  {
    icon: Link2,
    name: 'Priya',
    position: 'Director of Capital Markets',
    body: 'Matches the right capital to the right deal — mapping each opportunity to suitable LPs, co-investors, and lenders.'
  },
  {
    icon: Scale,
    name: 'Adrian',
    position: 'General Counsel & Compliance',
    body: 'Guards the downside — reviews structure, terms, and risk, keeping every engagement clean, compliant, and audit-ready.'
  },
  {
    icon: Megaphone,
    name: 'Sienna',
    position: 'Director of Communications',
    body: 'Shapes your narrative in market — message, positioning, and media, on brand and on the record.'
  },
  {
    icon: Search,
    name: 'Noah',
    position: 'Head of Digital Presence',
    body: 'Builds your organic visibility — so the right counterparties find you and your authority compounds over time.'
  },
  {
    icon: Filter,
    name: 'Camille',
    position: 'Head of Top-of-Funnel',
    body: 'Fills the top of your funnel — identifying and warming the right prospects so your pipeline never runs dry.'
  },
  {
    icon: Ticket,
    name: 'Jasper',
    position: 'Director of Private Events',
    body: 'Curates the rooms that matter — convening investors and operators in private settings built to deepen relationships.'
  },
  {
    icon: Users,
    name: 'Eleanor',
    position: 'Head of Investor Relations',
    body: 'Keeps your LPs close and confident — structured updates, reporting, and communications that protect and grow the relationship.'
  },
  {
    icon: Landmark,
    name: 'Sloane',
    position: 'Managing Director, Capital Formation',
    body: 'Runs institutional fundraising at the top of the market — a disciplined raise from target list to final close.'
  },
  {
    icon: GraduationCap,
    name: 'Felix',
    position: 'Director of Enablement',
    body: 'Gets you and your team to mastery fast — onboarding, education, and the playbooks that keep the whole desk running.'
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
  return (
    <section
      className="relative overflow-hidden pb-16 pt-28 sm:pb-20 sm:pt-32"
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

          {/* Live proof points — animated count-ups in an elevated strip. */}
          <HeroStats />
        </div>

        {/* Hero mascot with gentle float + gold glow, and a minimal "Meet Earn". */}
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
            <p className="mt-1.5 text-[15px] font-semibold text-fg-1">Earnest Fundmaker “Earn”</p>
            <p className="mt-0.5 text-[12px] text-fg-4">
              Chief Operating Officer · your live AI guide
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Two-letter monogram from a member's name — the avatar fallback. */
function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function TeamCard({ member }: { member: TeamMember }) {
  const Icon = member.icon;
  return (
    <Card clickable className="flex h-full items-start gap-4 p-5">
      <div className="relative flex-none">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] text-[13px] font-semibold tracking-wide text-gold-1"
          aria-hidden
        >
          {initials(member.name)}
        </div>
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-surface-1 text-fg-3">
          <Icon size={11} strokeWidth={2} aria-hidden />
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold leading-tight text-fg-1">{member.name}</h3>
        <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-gold-1">
          {member.position}
        </p>
        <p className="mt-2 text-[11.5px] leading-5 text-fg-3">{member.body}</p>
      </div>
    </Card>
  );
}

function Team() {
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

        {/* Earnest — the lead; Chief Operating Officer. */}
        <div className="mt-8">
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
                  Chief Operating Officer · live AI guide
                </p>
                <h3 className="mt-1 text-xl font-semibold text-fg-1">Earnest Fundmaker “Earn”</h3>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-fg-3">
                  Your right hand across the desk. Earnest takes your mandate, fronts the team, and
                  runs all fifteen as one — surfacing your next decision, routing each task to the
                  right specialist, and keeping every engagement moving from first thesis to signed
                  close. Measured, candid, and always on the record.
                </p>
              </div>
            </div>
          </Card>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map((member) => (
            <TeamCard key={member.name} member={member} />
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

        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_LAYERS.map((layer, i) => (
            <li key={layer.name}>
              <Card className="relative flex h-full flex-col overflow-hidden p-6">
                <span
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: `linear-gradient(90deg, ${layer.color}, transparent)` }}
                  aria-hidden
                />
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-4">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: layer.color, boxShadow: `0 0 10px ${layer.color}` }}
                      aria-hidden
                    />
                    Layer {`0${i + 1}`}
                  </span>
                  <ShieldCheck size={14} strokeWidth={1.8} className="text-fg-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-fg-1">{layer.name}</h3>
                <p className="mt-2 text-[12.5px] leading-6 text-fg-3">{layer.body}</p>
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
              <Card className="flex h-full flex-col p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] text-[15px] font-semibold tabular-nums text-gold-1">
                  {s.n}
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-fg-1">{s.title}</h3>
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
              AI copilots for the full capital lifecycle — capital formation, sourcing, diligence,
              packaging, and closing.
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
        <Team />
        <ChainOfTrust />
        <HowItWorks />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
