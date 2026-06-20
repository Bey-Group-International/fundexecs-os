import Link from "next/link";
import { redirect } from "next/navigation";
import { AGENTS } from "@/lib/agents";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const CALENDLY = "https://calendly.com/fundexecs";

const LOOP = [
  {
    step: "Instruct",
    body: "Tell Earn what needs to happen — in plain language. A deal to underwrite. A capital call to send. A memo due Thursday.",
  },
  {
    step: "Structure",
    body: "Earn builds an ordered plan and assigns the right agents. You see exactly what will happen before anything does.",
  },
  {
    step: "Authorize",
    body: "You approve the plan. No agent moves without your sign-off. Control stays with you.",
  },
  {
    step: "Deliver",
    body: "Agents execute in sequence and produce timestamped, version-controlled artifacts — IC memos, cap call notices, diligence reports.",
  },
];

const AGENT_COPY: Record<string, string> = {
  analyst:
    "Pro formas, valuations, and sensitivity analyses from raw deal data. Institutional-grade underwriting on demand.",
  associate:
    "The command layer. Earn routes every task, coordinates every agent, and keeps every workflow moving — across all domains.",
  investor_relations:
    "Capital relationship management — updates, capital calls, subscription docs, and reporting across LPs, family offices, and institutional co-investors.",
  portfolio_ops:
    "KPIs, budgets, and capex variance tracked across every asset. Flags problems before they reach a board report.",
  diligence:
    "Parses OMs, leases, and financials. Surfaces risk and produces IC-ready diligence memos.",
  fund_admin:
    "Waterfall calculations, fund accounting, and audit prep. Back-office coverage — without the back office.",
  executive_advisor:
    "Deep intelligence on every investor, family office, and strategic partner before first contact. Know who they are, what they want, and exactly how to position.",
  capital_raiser:
    "LP fundraising and capital formation from first outreach to signed commitment. Manages the Founding Capital Circle and anchor LP pipeline.",
  capital_connector:
    "Structures the capital stack for every transaction. Finds the right lender, equity partner, or financing vehicle — and closes the relationship.",
  deal_sourcer:
    "Identifies acquisition targets: underperforming, founder-owned, or transitioning businesses. Builds the thesis. Structures creative financing.",
  rainmaker:
    "Converts qualified prospects into commitments. Runs the closing sequence — from first conversation to signed terms.",
  lead_generator:
    "Digital funnels that capture investors, business owners, operators, and connectors. Measurable pipeline from click to conversation.",
  pr_director:
    "Investor decks, CIMs, executive summaries, and PR narratives. Positions the platform as institutional, culturally distinct, and serious.",
  seo_disruptor:
    "Turns content and thought leadership into category-defining search authority. The right capital and deal flow — without paid acquisition.",
  curator:
    "Designs private investor rooms and capital formation salons. Curates the room, the experience, and the follow-up that turns gatherings into relationships.",
};

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
            <ThemeToggle compact />
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
      <section className="fx-blueprint relative mx-auto max-w-6xl px-4 pb-20 pt-32 sm:px-6 sm:pb-24 sm:pt-40">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-72 max-w-3xl rounded-full bg-gold-500/15 blur-3xl"
        />
        <div className="grid items-center gap-16 lg:grid-cols-2">
          {/* Text */}
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-gold-500/30 bg-gold-500/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-300">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              Private equity · Real estate · Private credit · Family office
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
              The Operating System<br />
              for Private Markets
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-secondary">
              One platform. Fifteen AI agents. Every workflow from deal sourcing
              to capital formation to exit — unified, auditable, and under your control.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
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
              Pre-Alpha · Invite only · Built for operators running real capital
            </p>
          </div>

          {/* Command graph */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="fx-orbit-card min-h-[360px] w-full max-w-md p-5 sm:p-6">
              <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                    Live command graph
                  </p>
                  <p className="mt-1 text-sm text-fg-secondary">Earn routes capital work across agents.</p>
                </div>
                <span className="w-fit rounded-full border border-gold-500/35 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300">
                  60 FPS CSS
                </span>
              </div>
              <div className="relative z-10 mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ["Source", "124 LP paths"],
                  ["Run", "8 diligence rooms"],
                  ["Execute", "$42M marked"],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-line/80 bg-surface-0/55 p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
                    style={{ animationDelay: `${index * 120}ms` }}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</p>
                    <p className="mt-2 text-sm font-semibold text-fg-primary">{value}</p>
                  </div>
                ))}
              </div>
              <div className="relative z-10 mt-9 flex h-32 items-center justify-center sm:h-40">
                <span className="absolute h-24 w-24 rounded-full border border-gold-400/25 sm:h-32 sm:w-32" />
                <span className="absolute h-36 w-36 rounded-full border border-gold-400/10 sm:h-48 sm:w-48" />
                <span className="absolute h-3 w-3 rounded-full bg-gold-300 shadow-[0_0_24px_rgb(var(--fx-accent-rgb)/0.9)]" />
                {[
                  "Analyst",
                  "IR",
                  "Diligence",
                  "Admin",
                ].map((label, index) => (
                  <span
                    key={label}
                    className={`absolute rounded-full border border-gold-500/35 bg-surface-1 px-1.5 py-1 font-mono text-[9px] text-fg-secondary shadow-[0_0_22px_-10px_rgb(var(--fx-accent-rgb)/0.9)] sm:px-2 sm:text-[10px] ${
                      index === 0
                        ? "-top-1 left-1/2 -translate-x-1/2"
                        : index === 1
                          ? "right-0 top-1/2 -translate-y-1/2 sm:right-2"
                          : index === 2
                            ? "bottom-0 left-1/2 -translate-x-1/2"
                            : "left-0 top-1/2 -translate-y-1/2 sm:left-2"
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="fx-data-stream" />
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-line" />

      {/* How it works — video placeholder + loop */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Say it once.<br />Earn handles the rest.
            </h2>
            <p className="mt-4 text-fg-secondary">
              Direct Earn the way you would a senior operator.{" "}
              <span className="text-fg-primary">
                &ldquo;Run diligence on the acquisition target and get me an IC memo by Thursday.&rdquo;
              </span>{" "}
              Earn structures the work across the right agents — analyst, diligence, IR, fund admin — and presents a plan for your sign-off before anything moves.
            </p>

            {/* Use case examples */}
            <div className="mt-6 space-y-3">
              {[
                { label: "PE & Credit", example: "Model the LBO, stress-test debt capacity, draft the IC memo." },
                { label: "Capital Formation", example: "Build the LP outreach, track commitments, send the capital call." },
                { label: "Deal Sourcing", example: "Screen acquisition targets, score thesis fit, produce the screening report." },
                { label: "Portfolio Ops", example: "Pull KPIs across every asset, flag variances, deliver the board pack." },
              ].map((uc) => (
                <div key={uc.label} className="fx-glass flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                  <span className="mt-0.5 shrink-0 rounded-full border border-gold-500/30 bg-gold-500/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold-400">
                    {uc.label}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-fg-secondary">{uc.example}</span>
                </div>
              ))}
            </div>

            <ul className="mt-6 space-y-3 text-sm text-fg-secondary">
              {[
                "Nothing executes without your explicit sign-off",
                "Every run produces a timestamped, version-controlled artifact",
                "Full audit trail — from instruction to deliverable",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="mt-1 text-gold-400">→</span>
                  {f}
                </li>
              ))}
            </ul>

            {/* Booking CTA */}
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={CALENDLY}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-gold-400 px-5 py-2.5 text-sm font-medium text-surface-0 transition hover:opacity-90"
              >
                Book a demo
              </Link>
              <Link
                href="/login?mode=signup"
                className="rounded-md border border-line px-5 py-2.5 text-sm text-fg-secondary transition hover:bg-surface-2"
              >
                Request access
              </Link>
            </div>
          </div>

          {/* Right: loop */}
          <div className="flex flex-col gap-4">
            {/* Loop steps */}
            <div className="fx-card p-5 sm:p-6">
              <p className="mb-5 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
                The capital workflow loop
              </p>
              <div className="flex flex-col gap-5">
                {LOOP.map((l, i) => (
                  <div key={l.step} className="flex items-start gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 font-mono text-xs text-gold-300">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-fg-primary">{l.step}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{l.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-line" />

      {/* Agent Roster */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
          Agent Roster
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          Fifteen agents. One command layer.
        </h2>
        <p className="mt-3 max-w-xl text-fg-secondary">
          Each agent owns a domain. Earn coordinates them all.
          You authorize every move.
        </p>

        {/* Earn — featured */}
        {(() => {
          const earn = AGENTS.find((a) => a.key === "associate");
          if (!earn) return null;
          return (
            <div className="fx-card mt-8 border-gold-500/30 p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full ring-2 ring-gold-500/30"
                  style={{ backgroundColor: earn.color }}
                  aria-hidden
                />
                <h3 className="text-lg font-semibold">{earn.name}</h3>
                <span className="rounded-full border border-gold-500/20 bg-gold-500/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-gold-400">
                  Command layer
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-secondary">
                {AGENT_COPY[earn.key] ?? earn.role}
              </p>
            </div>
          );
        })()}

        {/* Remaining 14 agents */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.filter((a) => a.key !== "associate").map((agent) => (
            <div
              key={agent.key}
              className="fx-card fx-card-hover p-5"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: agent.color }}
                  aria-hidden
                />
                <h3 className="text-sm font-medium">{agent.name}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fg-secondary">
                {AGENT_COPY[agent.key] ?? agent.role}
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
          Built for operators<br />running real capital.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-fg-secondary">
          Invite-only. We&rsquo;re onboarding GPs, family offices, and advisory
          professionals ready to move off fragmented tools and onto one
          intelligent system.
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
            Data model first. Agents second. Capital third.
          </span>
        </div>
      </footer>

    </div>
  );
}
