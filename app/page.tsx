import Link from "next/link";
import { redirect } from "next/navigation";
import { HUBS } from "@/lib/hubs";
import { AGENTS } from "@/lib/agents";

const HUB_ICONS: Record<string, string> = {
  build: "◈",
  source: "◎",
  run: "◉",
  execute: "◆",
};

// GP-facing hub descriptions — what an operator actually does in each hub.
const HUB_COPY: Record<string, string> = {
  build:
    "Establish your firm identity — thesis, entity structure, brand, and track record. The foundation every deal and capital conversation rests on.",
  source:
    "Build and work your pipeline. Deals, equity capital, debt, co-invest, and advisory mandates. Every relationship tracked, every conversation logged.",
  run: "Evaluate active opportunities from first look to IC. Diligence, underwriting, stress testing, and investment committee prep — in one place.",
  execute:
    "Operate from close to exit. Capital events, asset-level KPIs, investor reporting, and exit management. No off-platform workarounds.",
};

// Three core modules per hub — lead with the highest-signal work.
const HUB_CORE_MODULES: Record<string, string[]> = {
  build: ["Thesis", "Entity", "Track Record"],
  source: ["Deal Pipeline", "LP Pipeline", "Debt & Hybrid"],
  run: ["Diligence", "Underwriting", "Stress Test"],
  execute: ["Capital Events", "Asset Management", "Reporting"],
};

// The capital workflow loop — institutional framing.
const LOOP = [
  {
    step: "Instruct",
    body: "Brief Earn in plain language — a deal to evaluate, an investor to update, a report to produce.",
  },
  {
    step: "Structure",
    body: "It builds an ordered plan and assigns the right agents to each step.",
  },
  {
    step: "Authorize",
    body: "You review the plan. No agent executes without your explicit sign-off.",
  },
  {
    step: "Deliver",
    body: "Agents execute and leave durable, auditable artifacts — IC memos, capital call notices, variance reports.",
  },
];

// Institutional agent descriptions — concrete, capital-markets facing.
const AGENT_COPY: Record<string, string> = {
  analyst:
    "Produces pro formas, valuations, and sensitivity analyses from raw deal data. Your underwriting desk — without the headcount.",
  associate:
    "Coordinates every workflow across all four hubs. Routes tasks, manages agent handoffs, keeps nothing siloed.",
  investor_relations:
    "Manages the full capital relationship cycle — investor updates, capital call notices, subscription documents, and reporting across LPs, family offices, and institutional co-investors.",
  portfolio_ops:
    "Tracks KPIs, budgets, and capex variance across every asset. Flags problems before they surface in a board report.",
  diligence:
    "Parses offering memoranda, leases, and financials. Surfaces risks and produces diligence memos ready for IC.",
  fund_admin:
    "Runs waterfall calculations, fund accounting, and audit prep. Back-office coverage without the back office.",
};

export default function LandingPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string; error_description?: string };
}) {
  // Safety net: if Supabase falls back to the Site URL after OAuth (because the
  // app's /auth/callback wasn't allow-listed), the auth code lands here on "/".
  // Forward it to the real callback so sign-in completes instead of bouncing.
  if (searchParams.code) {
    redirect(`/auth/callback?code=${encodeURIComponent(searchParams.code)}`);
  }
  if (searchParams.error) {
    const msg = searchParams.error_description || searchParams.error;
    redirect(`/login?error=${encodeURIComponent(msg)}`);
  }
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
      <section className="relative mx-auto max-w-6xl px-6 pb-24 pt-40">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-72 max-w-3xl rounded-full bg-gold-500/10 blur-3xl"
        />
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-gold-500/30 bg-gold-500/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-gold-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            For GPs, family offices, and advisory professionals
          </p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-tight lg:text-6xl">
            The Operating System<br />
            for Private Markets
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-secondary">
            Stop managing 30 tools. Start running your fund. FundExecs OS
            replaces your fragmented stack with one AI-native platform —
            unifying relationships, deals, and capital into a single intelligence layer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
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
          <p className="mt-4 font-mono text-xs text-fg-muted">
            Born from 4+ years of advisory — and 3 hours a day lost to deals that were smoke and mirrors.
          </p>
        </div>
      </section>

      <div className="border-t border-line" />

      {/* The capital workflow loop */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Every instruction becomes a traceable, auditable deliverable.
            </h2>
            <p className="mt-4 text-fg-secondary">
              Direct Earn the way you would a senior analyst.{" "}
              <span className="text-fg-primary">
                &ldquo;Produce a diligence memo on 123 Main Street by Thursday.&rdquo;
              </span>{" "}
              It structures the work, assigns agents, and presents a plan for your approval before a single action is taken.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-fg-secondary">
              {[
                "Approval-gated by default — nothing executes without your sign-off",
                "Every run leaves a timestamped, version-controlled artifact",
                "Full audit trail from instruction to deliverable",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="mt-1 text-gold-400">→</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* The loop, visualized */}
          <div className="rounded-2xl border border-line bg-surface-1 p-6">
            <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              The capital workflow loop
            </p>
            <div className="flex flex-col gap-4">
              {LOOP.map((l, i) => (
                <div key={l.step} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 font-mono text-xs text-gold-300">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-fg-primary">{l.step}</p>
                    <p className="text-xs leading-relaxed text-fg-secondary">{l.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-line" />

      {/* The Agents — moved above hubs, institutional presentation */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fg-secondary">
          Agent Roster
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          Six agents. Native to private markets.
        </h2>
        <p className="mt-3 max-w-xl text-fg-secondary">
          Each agent owns a domain — deal analysis, capital relations, diligence,
          portfolio operations, fund administration, workflow coordination.
          Coordinated by Earn. Authorized by you.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent) => (
            <div
              key={agent.key}
              className="rounded-xl border border-line bg-surface-1 p-5 transition hover:border-gold-500/30"
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
                {AGENT_COPY[agent.key] ?? agent.role}
              </p>
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
          Build your firm. Source deals and capital. Run active opportunities
          through diligence and underwriting. Execute from close to exit.
          Every workflow in one place.
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
                  <p className="mt-1 text-sm leading-relaxed text-fg-secondary">
                    {HUB_COPY[hub.key] ?? hub.purpose}
                  </p>
                </div>
                <span className="font-mono text-xs text-fg-muted">0{i + 1}</span>
              </div>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {(HUB_CORE_MODULES[hub.key] ?? hub.modules.slice(0, 3).map((m) => m.label)).map(
                  (label) => (
                    <span
                      key={label}
                      className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-fg-secondary"
                    >
                      {label}
                    </span>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-line" />

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          3 hours a day on smoke-and-mirrors deals.<br />
          There had to be a better way.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-fg-secondary">
          FundExecs OS was built by operators who lived the problem — sourcing
          pipelines full of noise, LP comms running on email threads, IC memos
          assembled at midnight. This is the system we needed and could not find.
        </p>
        <Link
          href="/login?mode=signup"
          className="mt-8 inline-block rounded-md bg-gold-400 px-6 py-3 text-sm font-medium text-surface-0 transition hover:opacity-90"
        >
          Request access
        </Link>
      </section>

      <footer className="border-t border-line px-6 py-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="font-mono text-xs text-fg-muted">FundExecs OS · Alpha</span>
          <span className="font-mono text-xs text-fg-muted">
            Data model first. API second. Agents third. UI last.
          </span>
        </div>
      </footer>
    </div>
  );
}
