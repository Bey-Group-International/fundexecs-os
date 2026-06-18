// "Brains at work" — the session theater. Renders every Brain activation logged
// to brain_runs for a session as an avatar card: who ran, the goal, status, the
// tools it reached for, a snippet of the deliverable, and the reasoning line.
import { BRAIN_BY_KEY } from "@/lib/brains";
import type { BrainRun } from "@/lib/supabase/database.types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function outputSnippet(output: BrainRun["output"]): string | null {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const text = (output as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  if (typeof output === "string") return output;
  return null;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "text-gold-400",
  running: "text-fg-secondary",
  awaiting_approval: "text-fg-secondary",
  failed: "text-fg-muted",
  pending: "text-fg-muted",
};

export default function BrainFeed({ runs }: { runs: BrainRun[] }) {
  return (
    <section>
      <h2 className="mb-2 mt-8 font-mono text-xs uppercase tracking-wider text-fg-muted">
        Brains at work
      </h2>

      {runs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No Brain activity in this session yet — run a workflow from Earn.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map((run) => {
            const brain = BRAIN_BY_KEY[run.brain_key as keyof typeof BRAIN_BY_KEY];
            const name = brain?.name ?? run.brain_key;
            const role = brain?.role ?? null;
            const tools = run.tools_used ?? [];
            const snippet = outputSnippet(run.output);
            const statusClass = STATUS_STYLES[run.status] ?? "text-fg-muted";

            return (
              <article
                key={run.id}
                className="rounded-xl border border-line bg-surface-1 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-mono text-[11px] font-semibold tracking-wider text-gold-400">
                    {initials(name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-fg-primary">
                        {name}
                      </span>
                      <span
                        className={`ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider ${statusClass}`}
                      >
                        {run.status}
                      </span>
                    </div>
                    {role && (
                      <p className="mt-0.5 truncate text-xs text-fg-muted">{role}</p>
                    )}
                  </div>
                </div>

                <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Goal
                </p>
                <p className="mt-1 text-sm text-fg-secondary">{run.goal}</p>

                {tools.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-secondary"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                )}

                {snippet && (
                  <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-fg-secondary">
                    {snippet}
                  </p>
                )}

                {run.reasoning && (
                  <p className="mt-3 border-t border-line pt-3 text-xs italic text-fg-muted">
                    {run.reasoning}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
