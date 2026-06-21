import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";

const CALENDLY = "https://calendly.com/fundexecs";

const HUBS = [
  {
    name: "Build",
    room: "Foundation room",
    task: "Thesis, team, materials, track record",
    signal: "Profile gap closed",
  },
  {
    name: "Source",
    room: "Capital room",
    task: "LPs, lenders, partners, targets",
    signal: "3 warm paths opened",
  },
  {
    name: "Run",
    room: "Deal room",
    task: "Diligence, models, IC memos, risk",
    signal: "IC memo drafting",
  },
  {
    name: "Execute",
    room: "Portfolio room",
    task: "Reporting, capital events, asset ops",
    signal: "LP update queued",
  },
];

const WORKSPACE_AGENTS = [
  {
    name: "Earn",
    role: "Orchestrating",
    color: "#60a5fa",
    x: "47%",
    y: "44%",
    task: "Routes the workflow and keeps every executive lane moving.",
  },
  {
    name: "Capital Raiser",
    role: "Sourcing LPs",
    color: "#ec4899",
    x: "22%",
    y: "24%",
    task: "Scans capital paths, ranks fit, and drafts the next outreach move.",
  },
  {
    name: "Analyst",
    role: "Building model",
    color: "#22d3ee",
    x: "72%",
    y: "26%",
    task: "Runs assumptions, sensitivity ranges, and debt capacity checks.",
  },
  {
    name: "Diligence",
    role: "Reading docs",
    color: "#ef4444",
    x: "68%",
    y: "68%",
    task: "Synthesizes risk, missing evidence, and IC-ready findings.",
  },
  {
    name: "Investor Relations",
    role: "Preparing update",
    color: "#f59e0b",
    x: "25%",
    y: "70%",
    task: "Turns progress into LP-ready narrative and approval language.",
  },
];

const WORKSPACE_NOTES = [
  "Hover an avatar: show current task, data source, and progress.",
  "Click an avatar: open the agent computation panel inside Earn.",
  "New workflow: light the hub room, animate the assigned executives, stream artifacts.",
  "Completed artifact: pulse the destination hub and pin the output to the timeline.",
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

      {/* Hero */}
      <section className="fx-blueprint relative mx-auto max-w-6xl px-4 pb-14 pt-32 sm:px-6 sm:pb-16 sm:pt-40">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-72 max-w-3xl rounded-full bg-gold-500/15 blur-3xl"
        />
        <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-gold-500/30 bg-gold-500/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-300">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              AI executive team for private markets
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-7xl">
              Your capital work,<br />
              moving in parallel.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-fg-secondary">
              FundExecs OS turns Build, Source, Run, and Execute into one living workspace.
              Earn coordinates AI executives that source capital, underwrite deals, prepare
              diligence, and package institutional work product while you stay in control.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/login?mode=signup"
                className="rounded-md bg-gold-400 px-5 py-2.5 text-sm font-medium text-surface-0 shadow-[0_14px_34px_-20px_rgb(var(--fx-accent-rgb)/0.95)] transition hover:opacity-90"
              >
                Request access
              </Link>
              <Link
                href={CALENDLY}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-line px-5 py-2.5 text-sm text-fg-secondary transition hover:bg-surface-2"
              >
                Book a demo
              </Link>
            </div>
            <p className="mt-4 font-mono text-xs text-fg-muted">
              Pre-Alpha · Invite only · Built for operators moving real capital
            </p>
        </div>
      </section>

      <div className="border-t border-line" />

      {/* Living workspace */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
              Living workspace
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              A spatial office for capital formation.
            </h2>
            <p className="mt-4 text-fg-secondary">
              The workspace sits directly after the hero because it explains the product in one view:
              your AI executive team moving through Build, Source, Run, and Execute while the work
              streams into artifacts you can inspect.
            </p>
            <div className="mt-6 grid gap-3">
              {[
                "Top-down like Gather.town: rooms, lanes, desks, and live team presence.",
                "Character-driven like The Sims: each executive has a job, status, and local context.",
                "Workflow-aware: rooms light up when a prompt triggers work in that hub.",
              ].map((line) => (
                <div key={line} className="fx-glass flex items-start gap-3 px-4 py-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-300" />
                  <span className="text-sm text-fg-secondary">{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="fx-card overflow-hidden p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                  Earn executive floor
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">Hover agents to see work in motion.</p>
              </div>
              <span className="rounded-full border border-status-success/35 bg-status-success/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-status-success">
                5 agents active
              </span>
            </div>

            <div className="relative min-h-[520px] overflow-hidden rounded-2xl border border-line bg-[#08121f] p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]">
              <div
                aria-hidden
                className="absolute inset-0 opacity-55 [background-image:linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] [background-size:24px_24px]"
              />
              <div className="relative grid h-[488px] grid-cols-2 grid-rows-2 gap-3">
                {HUBS.map((hub) => (
                  <div key={hub.name} className="group relative overflow-hidden rounded-xl border border-white/10 bg-surface-0/45 p-3 transition hover:border-gold-500/45">
                    <div className="absolute inset-x-3 top-10 h-px bg-gold-500/20" />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">{hub.name}</p>
                        <p className="mt-1 text-xs text-fg-muted">{hub.room}</p>
                      </div>
                      <span className="h-2 w-2 rounded-full bg-status-success shadow-[0_0_16px_rgb(34_197_94/0.8)]" />
                    </div>
                    <div className="mt-10 grid grid-cols-3 gap-2">
                      {[0, 1, 2, 3, 4, 5].map((desk) => (
                        <span key={desk} className="h-7 rounded border border-white/10 bg-white/[0.06]" />
                      ))}
                    </div>
                    <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-white/10 bg-black/35 px-3 py-2">
                      <p className="text-xs text-fg-secondary">{hub.task}</p>
                      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-gold-300">{hub.signal}</p>
                    </div>
                  </div>
                ))}

                <div className="pointer-events-none absolute inset-0">
                  <span className="absolute left-[17%] top-[50%] h-1 w-[66%] rounded-full bg-gold-500/20" />
                  <span className="absolute left-[50%] top-[16%] h-[68%] w-1 rounded-full bg-gold-500/20" />
                  <span className="absolute left-[50%] top-[50%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-300 shadow-[0_0_28px_rgb(var(--fx-accent-rgb)/0.9)]" />
                </div>

                {WORKSPACE_AGENTS.map((agent, index) => (
                  <div
                    key={agent.name}
                    className="group absolute z-10 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: agent.x, top: agent.y }}
                  >
                    <div className="relative">
                      <span
                        className="absolute -inset-2 animate-ping rounded-full opacity-20"
                        style={{ backgroundColor: agent.color, animationDelay: `${index * 140}ms` }}
                      />
                      <span
                        className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-black/40 text-xs font-bold text-white shadow-[0_8px_22px_-12px_black]"
                        style={{ backgroundColor: agent.color }}
                      >
                        {agent.name.slice(0, 1)}
                      </span>
                      <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-[#08121f] bg-status-success" />
                    </div>
                    <div className="pointer-events-none absolute left-1/2 top-12 w-52 -translate-x-1/2 rounded-xl border border-gold-500/30 bg-black/90 p-3 opacity-0 shadow-2xl transition group-hover:opacity-100">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">{agent.role}</p>
                      <p className="mt-1 text-sm font-medium text-fg-primary">{agent.name}</p>
                      <p className="mt-1 text-xs text-fg-secondary">{agent.task}</p>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                        <span className="block h-full w-3/4 rounded-full" style={{ backgroundColor: agent.color }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-gold-500/20 bg-black/55 p-3 backdrop-blur">
                <div className="grid gap-2 text-xs text-fg-secondary sm:grid-cols-3">
                  <span><strong className="text-fg-primary">Trigger:</strong> &ldquo;Source LPs and draft outreach&rdquo;</span>
                  <span><strong className="text-fg-primary">Routing:</strong> Source + Build active</span>
                  <span><strong className="text-fg-primary">Output:</strong> ranked LP list, memo, next moves</span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {WORKSPACE_NOTES.map((note) => (
                <p key={note} className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs text-fg-muted">
                  {note}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-line" />

      {/* Operating loop */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
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

      <div className="border-t border-line" />

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
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

      <footer className="border-t border-line px-4 py-6 sm:px-6">
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
