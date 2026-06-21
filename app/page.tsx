import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";

const CALENDLY = "https://calendly.com/fundexecs";

const HUBS = [
  {
    name: "Build",
    task: "Thesis, team, materials, track record",
    signal: "Profile gap closed",
  },
  {
    name: "Source",
    task: "LPs, lenders, partners, targets",
    signal: "3 warm paths opened",
  },
  {
    name: "Run",
    task: "Diligence, models, IC memos, risk",
    signal: "IC memo drafting",
  },
  {
    name: "Execute",
    task: "Reporting, capital events, asset ops",
    signal: "LP update queued",
  },
];

const DISTRICTS = [
  { name: "Capital Markets", asset: "/sprites/district-bank.svg", x: "9%", y: "16%", tag: "Gold: capital formation" },
  { name: "Lending", asset: "/sprites/district-bank.svg", x: "34%", y: "10%", tag: "Credit paths opening" },
  { name: "Investment Banking", asset: "/sprites/district-tower.svg", x: "63%", y: "13%", tag: "Deal packaging" },
  { name: "Relationship", asset: "/sprites/district-tower.svg", x: "13%", y: "48%", tag: "Warm intros" },
  { name: "Agent Nexus", asset: "/sprites/district-nexus.svg", x: "43%", y: "40%", tag: "GPU intelligence layer" },
  { name: "Legal & Compliance", asset: "/sprites/district-tower.svg", x: "72%", y: "45%", tag: "Risk gates" },
  { name: "Operating Company", asset: "/sprites/district-tower.svg", x: "25%", y: "72%", tag: "Operator context" },
  { name: "Analytics", asset: "/sprites/district-nexus.svg", x: "53%", y: "75%", tag: "Models + diligence" },
  { name: "Executive Council", asset: "/sprites/district-bank.svg", x: "78%", y: "73%", tag: "Approval layer" },
];

const CAMPUS_AGENTS = [
  {
    name: "Earn",
    asset: "/sprites/agent-earn.svg",
    lane: "pm-agent pm-agent-earn",
    role: "Fund Master Agent",
    task: "Coordinates the workflow across every district.",
  },
  {
    name: "Capital",
    asset: "/sprites/agent-capital.svg",
    lane: "pm-agent pm-agent-capital",
    role: "Capital Raising Agent",
    task: "Moves from investor fit to outreach draft.",
  },
  {
    name: "Deal Flow",
    asset: "/sprites/agent-deal.svg",
    lane: "pm-agent pm-agent-deal",
    role: "Deal Flow Agent",
    task: "Carries targets into analytics and diligence.",
  },
  {
    name: "Legal",
    asset: "/sprites/agent-legal.svg",
    lane: "pm-agent pm-agent-legal",
    role: "Legal & Compliance Agent",
    task: "Checks risk gates before capital moves.",
  },
  {
    name: "Operator",
    asset: "/sprites/agent-operator.svg",
    lane: "pm-agent pm-agent-operator",
    role: "Operating Company Agent",
    task: "Feeds company context into the execution loop.",
  },
];

const CAMPUS_SIGNALS = [
  "Visible executive sprites walk live workflows across the ecosystem.",
  "NVIDIA-green neural paths show AI activity underneath the private-market layer.",
  "Blue movement carries data; gold movement represents capital.",
  "Hover a sprite to see current role, task, and progress microcopy.",
];

export default function LandingPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string; error_description?: string };
}) {
  if (searchParams.code) {
    redirect(`/auth/callback?code=${encodeURIComponent(searchParams.code)}`);
  }
  if (searchParams.error) {
    const msg = searchParams.error_description || searchParams.error;
    redirect(`/login?error=${encodeURIComponent(msg)}`);
  }

  return (
    <div className="min-h-screen overflow-hidden bg-surface-0 text-fg-primary">
      {/* Nav */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-surface-0/82 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-md px-3 py-1.5 text-sm text-fg-secondary transition hover:text-fg-primary sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/login?mode=signup"
              className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:opacity-90"
            >
              Request access
            </Link>
          </div>
        </div>
      </header>

      {/* Living campus hero */}
      <section className="relative isolate min-h-screen overflow-hidden pt-14">
        <div className="pm-campus absolute inset-0 z-0">
          <div className="pm-gpu-grid" aria-hidden />
          <div className="pm-neural-path pm-neural-path-a" aria-hidden />
          <div className="pm-neural-path pm-neural-path-b" aria-hidden />
          <div className="pm-neural-path pm-neural-path-c" aria-hidden />
          <div className="pm-capital-flow pm-capital-flow-a" aria-hidden />
          <div className="pm-capital-flow pm-capital-flow-b" aria-hidden />

          {DISTRICTS.map((district) => (
            <div
              key={district.name}
              className="pm-district"
              style={{ left: district.x, top: district.y }}
            >
              <Image src={district.asset} alt="" width={96} height={80} className="pm-district-asset" />
              <div className="pm-district-label">
                <span>{district.name}</span>
                <small>{district.tag}</small>
              </div>
            </div>
          ))}

          {CAMPUS_AGENTS.map((agent) => (
            <div key={agent.name} className={agent.lane}>
              <Image src={agent.asset} alt={`${agent.name} sprite`} width={64} height={64} className="pm-agent-sprite" />
              <div className="pm-agent-panel">
                <span>{agent.role}</span>
                <strong>{agent.name}</strong>
                <p>{agent.task}</p>
              </div>
            </div>
          ))}

          <div className="pm-live-inspector">
            <p>Agent Nexus · live computation</p>
            <strong>Deal Flow → Analytics → Legal → Capital Markets</strong>
            <span>Context fetched · lender list scoring · diligence memo compiling</span>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-surface-0 via-surface-0/74 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-surface-0 via-surface-0/70 to-transparent" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-6xl flex-col justify-between px-4 py-10 sm:px-6 lg:py-14">
          <div className="max-w-3xl rounded-[2rem] border border-white/15 bg-[#050912]/90 p-5 text-white shadow-[0_28px_80px_-44px_rgb(0_0_0/0.9)] backdrop-blur-xl sm:p-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-gold-500/30 bg-white/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-300">
              <span className="h-1.5 w-1.5 rounded-full bg-[#76b900] shadow-[0_0_14px_#76b900]" />
              FundExecs Private Market OS
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
              The digital headquarters of the private markets.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">
              Watch AI executives source capital, move deals through diligence,
              coordinate lenders and advisors, and produce institutional work
              product inside one living operating system.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/login?mode=signup"
                className="pointer-events-auto rounded-md bg-gold-400 px-5 py-2.5 text-sm font-medium text-surface-0 shadow-[0_14px_34px_-20px_rgb(var(--fx-accent-rgb)/0.95)] transition hover:opacity-90"
              >
                Request access
              </Link>
              <Link
                href={CALENDLY}
                target="_blank"
                rel="noopener noreferrer"
                className="pointer-events-auto rounded-md border border-white/20 bg-white/10 px-5 py-2.5 text-sm text-slate-200 transition hover:bg-white/15"
              >
                Book a demo
              </Link>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-white/15 bg-[#050912]/88 p-4 backdrop-blur-xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#76b900]">
                Live workflow visible
              </p>
              <p className="mt-2 text-sm text-slate-200">
                Deal Flow walks to Analytics. Legal checks gates. Capital moves to Relationship.
                Earn coordinates the whole campus while blue data and green AI energy run underneath.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CAMPUS_SIGNALS.map((note) => (
                <p key={note} className="rounded-xl border border-white/15 bg-[#050912]/86 px-3 py-2 text-xs text-slate-300 backdrop-blur">
                  {note}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="relative z-10 border-t border-line bg-surface-0" />

      {/* Operating loop */}
      <section className="relative z-10 mx-auto max-w-6xl bg-surface-0 px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
            The operating loop
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            One instruction becomes coordinated execution.
          </h2>
          <p className="mt-3 text-fg-secondary">
            Earn turns a plain-language request into a plan, assigns the AI executive team,
            waits for approval, and returns artifacts tied to the workflow.
          </p>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-4">
          {HUBS.map((hub, index) => (
            <div key={hub.name} className="fx-card fx-card-hover p-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                0{index + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-fg-primary">{hub.name}</h3>
              <p className="mt-2 text-sm text-fg-secondary">{hub.task}</p>
              <p className="mt-4 rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                {hub.signal}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="relative z-10 border-t border-line bg-surface-0" />

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-6xl bg-surface-0 px-4 py-16 text-center sm:px-6 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          Early access
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">
          See the AI executive team work.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-fg-secondary">
          Invite-only for GPs, family offices, and advisory professionals ready
          to move from fragmented tools into one living operating system.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={CALENDLY}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-gold-400 px-6 py-3 text-sm font-medium text-surface-0 transition hover:opacity-90"
          >
            Book a demo
          </Link>
          <Link
            href="/login?mode=signup"
            className="rounded-md border border-line px-6 py-3 text-sm text-fg-secondary transition hover:bg-surface-2"
          >
            Request access
          </Link>
        </div>
        <p className="mt-6 font-mono text-xs text-fg-muted">
          Pre-Alpha · No credit card required
        </p>
      </section>

      <footer className="relative z-10 border-t border-line bg-surface-0 px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <span className="font-mono text-xs text-fg-muted">FundExecs OS · Alpha</span>
          <span className="font-mono text-xs text-fg-muted">
            Build &gt; Source &gt; Run &gt; Execute
          </span>
        </div>
      </footer>

    </div>
  );
}
