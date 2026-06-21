import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { PrivateMarketWorkspace } from "@/components/landing/PrivateMarketWorkspace";

const CALENDLY = "https://calendly.com/fundexecs";

const OPERATING_LOOP = [
  {
    step: "Build",
    body: "Firm identity, thesis, materials, entities, team, and track record become structured operating context.",
    signal: "Foundation ready",
  },
  {
    step: "Source",
    body: "Earn activates LP, lender, partner, provider, and deal sourcing across the private-market ecosystem.",
    signal: "Capital paths open",
  },
  {
    step: "Run",
    body: "Underwriting, diligence, risk, and IC work move through specialist offices with approval gates.",
    signal: "Decision pack forming",
  },
  {
    step: "Execute",
    body: "Capital events, reporting, asset management, closing, and compliance become auditable workflows.",
    signal: "Artifacts delivered",
  },
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
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            Private Market Ecosystem
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-7xl">
            Your AI executive team,<br />
            working beside you.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-fg-secondary">
            FundExecs OS turns plain-language capital work into an auditable session:
            Earn proposes the plan, your executive offices activate, and Workclaw-style
            automation executes only after approval.
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
            Next.js + Tailwind interface · Cursor/Tasklet inspired · Built for private capital operators
          </p>
        </div>
      </section>

      <div className="border-t border-line" />

      <PrivateMarketWorkspace />

      <div className="border-t border-line" />

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
            Session activity model
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            Idle headquarters becomes live execution.
          </h2>
          <p className="mt-3 text-fg-secondary">
            The workspace mirrors actual conversation milestones: no session,
            prompt review, Earn-led strategy, then full team automation.
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

      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          Early access
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight">
          See the private-market HQ in motion.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-fg-secondary">
          Invite-only for GPs, family offices, lenders, advisors, operators, and
          private-market teams ready to replace fragmented tools with one living system.
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
