import Link from "next/link";
import { HUBS } from "@/lib/hubs";
import { AGENTS } from "@/lib/agents";

const HUB_ICONS: Record<string, string> = {
  build: "◈",
  source: "◎",
  run: "◉",
  execute: "◆",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-0 text-fg-primary">
      {/* Top nav */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-surface-0/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            FundExecs OS
          </span>
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
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-40">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
            Private markets infrastructure
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.1] tracking-tight lg:text-6xl">
            The Operating System<br />
            for Private Markets
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-secondary">
            PE funds, real estate investors, and family offices run on 30+ point
            solutions. FundExecs OS replaces all of them — one AI-native platform
            that unifies relationships, deals, and capital into a single
            intelligence layer.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              href="/login?mode=signup"
              className="rounded-md bg-gold-400 px-5 py-2.5 text-sm font-medium text-surface-0 transition hover:opacity-90"
            >
              Request access
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-line px-5 py-2.5 text-sm text-fg-secondary transition hover:bg-surface-2"
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Stat strip */}
        <div className="mt-16 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-surface-2">
          {[
            { label: "Point solutions replaced", value: "30+" },
            { label: "AI agent workflows", value: "6" },
            { label: "Hub modules", value: "22" },
          ].map((s) => (
            <div key={s.label} className="bg-surface-0 px-6 py-5">
              <p className="text-2xl font-semibold text-fg-primary">{s.value}</p>
              <p className="mt-0.5 text-xs text-fg-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-line" />

      {/* The Four Hubs */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
          Architecture
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          Four hubs. One operating system.
        </h2>
        <p className="mt-3 max-w-xl text-fg-secondary">
          Every action an operator takes — from building their identity to
          exiting an asset — belongs to one of four hubs. Nothing falls through
          the cracks.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {HUBS.map((hub, i) => (
            <div
              key={hub.key}
              className="rounded-xl border border-line bg-surface-1 p-6 transition hover:border-gold-500/30 hover:bg-surface-2"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-mono text-lg text-gold-400">
                    {HUB_ICONS[hub.key]}
                  </span>
                  <h3 className="mt-2 text-lg font-medium">{hub.label}</h3>
                  <p className="mt-1 text-sm text-fg-secondary">{hub.purpose}</p>
                </div>
                <span className="font-mono text-xs text-fg-muted">0{i + 1}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {hub.modules.map((m) => (
                  <span
                    key={m.key}
                    className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-fg-secondary"
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-line" />

      {/* The Six Agents */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
          AI Agents
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          Six agents. Every workflow covered.
        </h2>
        <p className="mt-3 max-w-xl text-fg-secondary">
          Each agent owns a domain of private-market expertise. They operate
          natively — no third-party AI SDKs. You approve, they execute.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent) => (
            <div
              key={agent.key}
              className="rounded-xl border border-line bg-surface-1 p-5 transition hover:border-line"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: agent.color }}
                  aria-hidden
                />
                <h3 className="font-medium">{agent.name}</h3>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-fg-secondary">
                {agent.role}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-line" />

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          Built for operators who move capital.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-fg-secondary">
          If you spend hours every week sourcing deals that go nowhere, managing
          LP comms in spreadsheets, or waiting on reports — FundExecs OS is
          built for you.
        </p>
        <Link
          href="/login?mode=signup"
          className="mt-8 inline-block rounded-md bg-gold-400 px-6 py-3 text-sm font-medium text-surface-0 transition hover:opacity-90"
        >
          Request early access
        </Link>
      </section>

      <footer className="border-t border-line px-6 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="font-mono text-xs text-fg-muted">FundExecs OS · Pre-Alpha</span>
          <span className="font-mono text-xs text-fg-muted">
            Data model first. API second. Agents third. UI last.
          </span>
        </div>
      </footer>
    </div>
  );
}
