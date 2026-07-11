import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { GradientText } from "@/components/marketing/GradientText";
import { SpinBorderButton } from "@/components/marketing/SpinBorderButton";
import { StatCounter } from "@/components/marketing/StatCounter";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { MeetEarnTeam } from "@/components/marketing/MeetEarnTeam";
import { WorkspacePreview } from "@/components/marketing/WorkspacePreview";

const OPERATING_LOOP = [
  {
    step: "Build",
    body: "Establish the firm's foundation — profile, mandate, strategy, and readiness that every downstream workflow inherits.",
    signal: "Foundation set",
    color: "#22d3ee",
  },
  {
    step: "Source",
    body: "Build and qualify pipeline — LP and deal flow, prospecting, and intent signals routed to the right executive.",
    signal: "Pipeline routed",
    color: "#6366f1",
  },
  {
    step: "Run",
    body: "Diligence and underwriting — analysts parse documents, model deals, and flag risk before a decision is made.",
    signal: "Diligence cleared",
    color: "#a855f7",
  },
  {
    step: "Execute",
    body: "Post-close capital operations — LP updates, capital calls, distributions, fund accounting, and reporting.",
    signal: "Capital in motion",
    color: "#f59e0b",
  },
];

const FAQ_ITEMS = [
  {
    question: "What is FundExecs OS?",
    answer:
      "An AI-native operating system for private-market participants. Earn plans, delegates, and routes decisions while an AI workforce sources deals, raises capital, conducts diligence, manages relationships, and executes transactions — all from one command surface.",
  },
  {
    question: "Who is it for?",
    answer:
      "Private equity, search funds, family offices, sponsors, banks, and capital raisers — operators who move capital at scale and want an execution layer that replaces fragmented spreadsheets, email threads, and CRMs.",
  },
  {
    question: "How does the agent stay under control?",
    answer:
      "Every workstream runs through explicit approval gates. Earn structures analysis, planning, delegation, and delivery so the operating model stays visible from objective to outcome, and nothing outbound happens without a human sign-off.",
  },
  {
    question: "How do I get access?",
    answer:
      "FundExecs OS is invite-only during early access. Request access and our team will onboard your first mandate.",
  },
];

export default async function LandingPage(
  props: {
    searchParams: Promise<{ code?: string; error?: string; error_description?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  if (searchParams.code) {
    redirect(`/auth/callback?code=${encodeURIComponent(searchParams.code)}`);
  }
  if (searchParams.error) {
    const msg = searchParams.error_description || searchParams.error;
    redirect(`/login?error=${encodeURIComponent(msg)}`);
  }

  return (
    <div className="min-h-screen overflow-hidden bg-surface-0 text-fg-primary">
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

      <section className="fx-blueprint relative mx-auto max-w-6xl px-4 pb-12 pt-32 sm:px-6 sm:pb-16 sm:pt-40">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-72 max-w-3xl rounded-full bg-gold-500/15 blur-3xl"
        />
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-gold-500/30 bg-gold-500/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-300">
            Private Markets Operating System
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-7xl">
            The <GradientText as="span">AI-native operating system</GradientText>{" "}
            for private-market operations.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-fg-secondary">
            Deploy end-to-end workflows across the full lifecycle, powered by an
            agentic executive layer that unifies fragmented deal, capital, and
            relationship data into a single system of record.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <SpinBorderButton href="#meet-earn">
              Meet Earn
            </SpinBorderButton>
            <Link
              href="#workspace-preview"
              className="rounded-md border border-line px-5 py-2.5 text-sm text-fg-secondary transition hover:bg-surface-2"
            >
              Explore Workspace
            </Link>
          </div>
          <p className="mt-4 font-mono text-xs text-fg-muted">
            Institutional execution layer for private equity, search funds, family offices, sponsors, banks, and capital raisers
          </p>
        </div>
      </section>

      <div className="border-t border-line" />

      {/* Social proof strip — one unified inline metric band */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-line bg-surface-1 px-6 py-7">
          <p className="mb-6 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
            Built for operators who move capital at scale
          </p>
          <div className="flex flex-col divide-y divide-line/70 sm:flex-row sm:divide-x sm:divide-y-0">
            <StatCounter
              className="flex-1 px-4 py-3 sm:py-0"
              value={2}
              prefix="$"
              suffix="B+"
              label="private-market deal flow tracked"
            />
            <StatCounter
              className="flex-1 px-4 py-3 sm:py-0"
              value={4}
              suffix=" hubs"
              label="Build · Source · Run · Execute lifecycle"
            />
            <StatCounter
              className="flex-1 px-4 py-3 sm:py-0"
              value={15}
              label="AI executives — Earn + 14 specialists"
            />
          </div>
          <blockquote className="mt-6 border-t border-line/60 pt-5 text-center text-sm italic text-fg-secondary">
            &ldquo;FundExecs OS gives our team an execution layer we couldn&rsquo;t afford to hire — Earn does in minutes what used to take a full analyst day.&rdquo;
            <cite className="mt-2 block not-italic font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              Early-access fund operator
            </cite>
          </blockquote>
        </div>
      </section>

      <div className="border-t border-line" />

      <MeetEarnTeam />

      <div className="border-t border-line" />

      <WorkspacePreview />

      <div className="border-t border-line" />

      <section id="operating-model" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 scroll-mt-20">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
            Operating framework
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            One lifecycle, four hubs, every action accountable.
          </h2>
          <p className="mt-3 text-fg-secondary">
            FundExecs OS runs the private-market lifecycle through four hubs —
            Build, Source, Run, and Execute — with Earn routing work to the
            right executive and holding every outbound action at an approval
            gate.
          </p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {OPERATING_LOOP.map((item, index) => (
            <div
              key={item.step}
              className="fx-card fx-card-hover group relative flex flex-col rounded-2xl p-5 transition-colors"
            >
              {/* Hub accent bar */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl opacity-80"
                style={{
                  background: `linear-gradient(90deg, ${item.color}, transparent)`,
                }}
              />

              {/* Lifecycle flow arrow into the next hub */}
              {index < OPERATING_LOOP.length - 1 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-[-14px] top-1/2 z-10 hidden -translate-y-1/2 text-lg text-fg-muted transition-colors group-hover:text-fg-secondary md:block"
                >
                  ›
                </span>
              )}

              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-semibold"
                  style={{
                    color: item.color,
                    backgroundColor: `${item.color}1f`,
                    boxShadow: `inset 0 0 0 1px ${item.color}40`,
                  }}
                >
                  0{index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-fg-primary">{item.step}</h3>
                  <span className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">
                    Hub {index + 1} of {OPERATING_LOOP.length}
                  </span>
                </div>
              </div>

              <p className="mt-4 flex-1 text-sm text-fg-secondary">{item.body}</p>

              <p className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.signal}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-line" />

      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-8 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            FAQ
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            Frequently asked questions
          </h2>
        </div>
        <FaqAccordion items={FAQ_ITEMS} />
      </section>

      <div className="border-t border-line" />

      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          Early access
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">
          Meet the executive agent that runs the operating system.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-fg-secondary">
          Invite-only for private-market teams ready to replace fragmented tools
          with one autonomous execution layer.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-md border border-line px-6 py-3 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
          >
            Sign in
          </Link>
          <Link
            href="/login?mode=signup"
            className="rounded-md bg-gold-400 px-6 py-3 text-sm font-medium text-surface-0 transition hover:opacity-90"
          >
            Request access
          </Link>
        </div>
      </section>

      <footer className="border-t border-line px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 sm:flex-row sm:justify-between">
          <div className="flex flex-col items-center gap-1 text-center sm:items-start sm:text-left">
            <span className="font-mono text-xs text-fg-muted">FundExecs OS · Early Access</span>
            <span className="font-mono text-[11px] text-fg-muted">
              Build &gt; Source &gt; Run &gt; Execute
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 text-sm text-fg-secondary transition hover:text-fg-primary"
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
      </footer>
    </div>
  );
}
