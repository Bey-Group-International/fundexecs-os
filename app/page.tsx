import Link from "next/link";
import { HUBS } from "@/lib/hubs";
import { AGENTS } from "@/lib/agents";

// Pre-Alpha scaffold landing. Renders the architecture (four hubs, six agents)
// directly from the lib catalogs so the data model and the UI never drift.
// This is intentionally static — the live, agent-driven workspace comes after
// the task-engine API layer is built (see AGENT.md build order).
export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-16">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          Pre-Alpha · Scaffolding
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          FundExecs&nbsp;OS
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-fg-secondary">
          An AI-native operating system for private-market participants —
          unifying relationships, deals, and capital into a single intelligence
          layer, with AI agents that execute workflows end-to-end.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/workspace"
            className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:opacity-90"
          >
            Launch workspace
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mb-16">
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-fg-muted">
          The Four Hubs
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {HUBS.map((hub) => (
            <div
              key={hub.key}
              className="rounded-xl border border-line bg-surface-1 p-5"
            >
              <h3 className="text-lg font-medium capitalize">{hub.label}</h3>
              <p className="mt-1 text-sm text-fg-secondary">{hub.purpose}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
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

      <section>
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-fg-muted">
          The Six Agents
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent) => (
            <div
              key={agent.key}
              className="rounded-xl border border-line bg-surface-1 p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: agent.color }}
                  aria-hidden
                />
                <h3 className="font-medium">{agent.name}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fg-secondary">
                {agent.role}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-20 border-t border-line pt-6 text-xs text-fg-muted">
        Data model first. API second. Agents third. WebSocket fourth. UI last.
      </footer>
    </main>
  );
}
