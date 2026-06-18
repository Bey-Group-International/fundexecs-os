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
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-agent-associate">
          Pre-Alpha · Scaffolding
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          FundExecs&nbsp;OS
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-neutral-400">
          An AI-native operating system for private-market participants —
          unifying relationships, deals, and capital into a single intelligence
          layer, with AI agents that execute workflows end-to-end.
        </p>
      </header>

      <section className="mb-16">
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          The Four Hubs
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {HUBS.map((hub) => (
            <div
              key={hub.key}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5"
            >
              <h3 className="text-lg font-medium capitalize">{hub.label}</h3>
              <p className="mt-1 text-sm text-neutral-400">{hub.purpose}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hub.modules.map((m) => (
                  <span
                    key={m.key}
                    className="rounded-md bg-neutral-800/60 px-2 py-0.5 text-xs text-neutral-300"
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
        <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          The Six Agents
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent) => (
            <div
              key={agent.key}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: agent.color }}
                  aria-hidden
                />
                <h3 className="font-medium">{agent.name}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                {agent.role}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-20 border-t border-neutral-900 pt-6 text-xs text-neutral-600">
        Data model first. API second. Agents third. WebSocket fourth. UI last.
      </footer>
    </main>
  );
}
