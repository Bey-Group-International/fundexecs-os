import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { GradientText } from "@/components/marketing/GradientText";
import { SpinBorderButton } from "@/components/marketing/SpinBorderButton";
import { StatCounter } from "@/components/marketing/StatCounter";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";

const OPERATING_LOOP = [
  {
    step: "Command",
    body: "The operator gives Earn a private-market objective in plain language.",
    signal: "Request analyzed",
  },
  {
    step: "Plan",
    body: "Earn creates objectives, workstreams, agent assignments, and approval gates.",
    signal: "Strategy ready",
  },
  {
    step: "Execute",
    body: "AI executives source, raise, diligence, document, and follow up across the operating campus.",
    signal: "Agents assigned",
  },
  {
    step: "Report",
    body: "Outcomes collapse into the dashboard as targets, introductions, packages, and updates.",
    signal: "Results delivered",
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
            FundExecs OS is an{" "}
            <GradientText as="span">autonomous executive team</GradientText> for
            private markets.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-fg-secondary">
            Earn plans, delegates, monitors, and routes decisions while an AI
            workforce sources deals, raises capital, conducts diligence, manages
            relationships, and executes transactions.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <SpinBorderButton href="/login?mode=signup">
              Meet Earn
            </SpinBorderButton>
            <Link
              href="#operating-model"
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

      {/* Social proof strip */}
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="rounded-2xl border border-line bg-surface-1 px-6 py-8">
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted mb-6">
            Built for operators who move capital at scale
          </p>
          <div className="grid gap-6 sm:grid-cols-3">
            <StatCounter
              value={2}
              prefix="$"
              suffix="B+"
              label="private-market deal flow tracked by early teams"
            />
            <StatCounter
              value={4}
              suffix=" hubs"
              label="replacing fragmented spreadsheets, email threads, and CRMs"
            />
            <StatCounter
              value={1}
              suffix=" agent"
              label="Earn plans, delegates, and delivers like a senior exec"
            />
          </div>
          <blockquote className="mt-8 border-l-2 border-gold-500/40 pl-4 text-sm italic text-fg-secondary">
            &ldquo;FundExecs OS gives our team an execution layer we couldn&rsquo;t afford to hire — Earn does in minutes what used to take a full analyst day.&rdquo;
            <cite className="mt-2 block not-italic font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              Early-access fund operator
            </cite>
          </blockquote>
        </div>
      </section>

      <section id="operating-model" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 scroll-mt-20">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
            Operating model
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            The operating model stays visible from objective to outcome.
          </h2>
          <p className="mt-3 text-fg-secondary">
            Each node and assignment shows how Earn structures analysis,
            planning, approval, delegation, and delivery.
          </p>
        </div>
        <div className="mt-8 grid gap-3 md:grid-cols-4">
          {OPERATING_LOOP.map((item, index) => (
            <div key={item.step} className="fx-card fx-card-hover p-5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                0{index + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-fg-primary">{item.step}</h3>
              <p className="mt-2 text-sm text-fg-secondary">{item.body}</p>
              <p className="mt-4 rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
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
          <SpinBorderButton href="/login?mode=signup">Meet Earn</SpinBorderButton>
          <Link
            href="#operating-model"
            className="rounded-md border border-line px-6 py-3 text-sm text-fg-secondary transition hover:bg-surface-2"
          >
            Explore Workspace
          </Link>
        </div>
      </section>

      <footer className="border-t border-line px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <span className="font-mono text-xs text-fg-muted">FundExecs OS · Early Access</span>
          <span className="font-mono text-xs text-fg-muted">
            Build &gt; Source &gt; Run &gt; Execute
          </span>
        </div>
      </footer>
    </div>
  );
}
