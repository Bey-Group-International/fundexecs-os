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

// The product loop, in four beats — the spine of every workflow and automation.
const LOOP = [
  { step: "Prompt", body: "Tell the Associate what you need, in plain English." },
  { step: "Plan", body: "It routes the work to the right agents as ordered steps." },
  { step: "Approve", body: "You review the plan. Nothing runs until you say so." },
  { step: "Deliver", body: "Agents execute and leave durable artifacts — IC memos, models, LP updates." },
];

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

        {/* Stat strip */}
        <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-surface-2 sm:grid-cols-4">
          {[
            { label: "Point solutions replaced", value: "30+" },
            { label: "AI agents", value: "6" },
            { label: "Operational hubs", value: "4" },
            { label: "Always-on automations", value: "24/7" },
          ].map((s) => (
            <div key={s.label} className="bg-surface-0 px-6 py-5">
              <p className="text-2xl font-semibold text-fg-primary">{s.value}</p>
              <p className="mt-0.5 text-xs text-fg-secondary">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-line" />

      {/* Agents that own the work — the differentiator */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
              Automations
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Agents that own the work
            </h2>
            <p className="mt-4 text-fg-secondary">
              Save an instruction once — <span className="text-fg-primary">&ldquo;Every Monday,
              summarize what moved in our pipeline&rdquo;</span> — and it runs on a schedule,
              plans itself, and executes end-to-end. Approval-gated by default; flip on
              auto-approve only for the work you trust to run unattended.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-fg-secondary">
              {[
                "Scheduled & on-demand triggers — daily, weekly, or run now",
                "Opt-in autonomy — you stay in the loop until you choose not to",
                "Every run leaves a durable, auditable deliverable",
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
              The loop — every workflow, every automation
            </p>
            <div className="flex flex-col gap-3">
              {LOOP.map((l, i) => (
                <div key={l.step} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 font-mono text-xs text-gold-300">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-fg-primary">{l.step}</p>
                    <p className="text-xs text-fg-secondary">{l.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
