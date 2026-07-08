import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GradientText } from "@/components/marketing/GradientText";
import { SpinBorderButton } from "@/components/marketing/SpinBorderButton";
import { StatCounter } from "@/components/marketing/StatCounter";

export const metadata: Metadata = {
  title: "Marketing",
  description:
    "An AI-native operating system for private-market participants — source, raise, diligence, and report from one command surface.",
};

// Proof-of-concept marketing surface. It exists to show the adopted Evalyze
// patterns — animated gradient text, the spinning conic CTA, and scroll-in stat
// counters — living natively in the FundExecs gold→neural dark system, composed
// from components/marketing/*. Reveals reuse the existing `animate-fade-up`
// keyframe with staggered inline delays.
const STATS = [
  { value: 1200, suffix: "+", label: "Deals sourced by agents" },
  { value: 48, suffix: "h", label: "Median time to first package" },
  { value: 96, suffix: "%", label: "Approval-gate pass rate" },
  { value: 30, suffix: "k", label: "LP touchpoints orchestrated" },
];

export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-surface-0 text-fg-primary">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-surface-0/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo variant="coin-wordmark" />
          <div className="flex items-center gap-3">
            <SpinBorderButton href="/login">Get started</SpinBorderButton>
            <ThemeToggle compact />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto flex max-w-4xl flex-col items-center gap-7 px-6 pb-24 pt-20 text-center lg:pt-28">
        <span
          className="animate-fade-up rounded-full border border-line/70 bg-surface-1/70 px-3 py-1 font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary"
          style={{ animationDelay: "0ms" }}
        >
          Private markets, on autopilot
        </span>

        <h1
          className="animate-fade-up font-display text-4xl font-bold !leading-tight tracking-tight sm:text-5xl lg:text-6xl"
          style={{ animationDelay: "80ms" }}
        >
          Run your fund from a single{" "}
          <GradientText as="span">command surface</GradientText>.
        </h1>

        <p
          className="animate-fade-up max-w-2xl text-lg text-fg-secondary lg:text-xl"
          style={{ animationDelay: "160ms" }}
        >
          AI executives source, raise, diligence, document, and follow up across
          your operating campus — collapsing outcomes into one live dashboard.
        </p>

        <div
          className="animate-fade-up flex flex-col items-center gap-3 sm:flex-row"
          style={{ animationDelay: "240ms" }}
        >
          <SpinBorderButton href="/login">Get started for free</SpinBorderButton>
          <a
            href="#stats"
            className="fx-btn-secondary"
          >
            See the numbers
          </a>
        </div>
      </section>

      {/* Stats band */}
      <section
        id="stats"
        className="border-y border-line/60 bg-surface-1/40 py-16 lg:py-20"
      >
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-12 text-center text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Built for operators
          </h2>
          <div className="grid grid-cols-2 place-items-center gap-10 lg:grid-cols-4">
            {STATS.map((stat) => (
              <StatCounter
                key={stat.label}
                value={stat.value}
                suffix={stat.suffix}
                label={stat.label}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-24 text-center">
        <h2 className="font-display text-3xl font-bold lg:text-4xl">
          Raise with <GradientText as="span">confidence</GradientText>.
        </h2>
        <p className="text-fg-secondary lg:text-lg">
          Give Earn an objective in plain language and watch the operating loop
          run — Command, Plan, Execute, Report.
        </p>
        <SpinBorderButton href="/login">Start now</SpinBorderButton>
      </section>
    </main>
  );
}
