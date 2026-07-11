import { AGENTS } from "@/lib/agents";
import { AccessGate } from "./AccessGate";

// "Explore Workspace" reveal. A faithful static mock of the real command surface
// (components/Workspace.tsx): the objective bar, live task rows with agent
// progress, a pending approval gate, and the agent rail. It renders sample data
// only — no live tasks — and fades into the AccessGate so a visitor sees exactly
// what they're being invited into without reaching the authed workspace.
const SAMPLE_TASKS = [
  {
    title: "Underwrite the Maple Street acquisition",
    agentKey: "analyst",
    hub: "run",
    status: "running",
    progress: 0.72,
  },
  {
    title: "Draft the Q3 LP capital-call notice",
    agentKey: "investor_relations",
    hub: "execute",
    status: "review",
    progress: 1,
  },
  {
    title: "Flag risks in the Northwind data room",
    agentKey: "diligence",
    hub: "run",
    status: "running",
    progress: 0.41,
  },
] as const;

const RAIL = ["associate", "analyst", "diligence", "capital_raiser", "deal_sourcer"] as const;

function agent(key: string) {
  return AGENTS.find((a) => a.key === key);
}

export function WorkspacePreview() {
  return (
    <section
      id="workspace-preview"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold-400">
          The workspace
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          One command surface for the entire operating campus.
        </h2>
        <p className="mt-3 text-fg-secondary">
          Give Earn an objective; watch it route work to the right executive, run
          the task, and hold every outbound action at an approval gate.
        </p>
      </div>

      <div className="relative mt-10">
        <div
          aria-hidden
          className="pointer-events-none select-none [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
        >
          <div className="fx-glass mx-auto max-w-4xl p-4 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
              {/* Command column */}
              <div>
                <div className="flex gap-2">
                  <div className="flex flex-1 items-center rounded-md border border-line bg-surface-1/60 px-3 py-2 text-sm text-fg-muted">
                    Underwrite the Maple Street acquisition…
                  </div>
                  <div
                    className="flex items-center rounded-md px-4 py-2 text-sm font-medium text-surface-0"
                    style={{ backgroundColor: agent("associate")?.color }}
                  >
                    Run
                  </div>
                </div>

                <h3 className="mb-3 mt-6 font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Tasks
                </h3>
                <div className="flex flex-col gap-2">
                  {SAMPLE_TASKS.map((task) => {
                    const a = agent(task.agentKey);
                    return (
                      <div
                        key={task.title}
                        className="rounded-lg border border-line bg-surface-1/40 p-4"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: a?.color }}
                          />
                          <span className="text-sm font-medium text-fg-primary">
                            {task.title}
                          </span>
                          <span className="ml-auto rounded bg-surface-2 px-2 py-0.5 text-xs text-fg-secondary">
                            {task.status}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs text-fg-muted">
                          <span>{a?.name}</span>
                          <span className="capitalize">· {task.hub}</span>
                          <div className="ml-auto h-1.5 w-24 overflow-hidden rounded bg-surface-2">
                            <div
                              className="h-full rounded"
                              style={{
                                width: `${Math.round(task.progress * 100)}%`,
                                backgroundColor: a?.color,
                              }}
                            />
                          </div>
                        </div>
                        {task.status === "review" && (
                          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                            <span className="text-xs text-fg-secondary">
                              Draft ready — awaiting your approval.
                            </span>
                            <div className="ml-auto flex gap-1.5">
                              <span className="rounded bg-green-500/15 px-2 py-1 text-xs text-green-300">
                                Approve
                              </span>
                              <span className="rounded bg-surface-2 px-2 py-1 text-xs text-fg-secondary">
                                Regenerate
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Agent rail */}
              <div>
                <h3 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Agents
                </h3>
                <div className="flex flex-col gap-1.5">
                  {RAIL.map((key) => {
                    const a = agent(key);
                    if (!a) return null;
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-2 rounded-md border border-line bg-surface-1/40 px-3 py-2 text-sm"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: a.color }}
                        />
                        <span className="text-fg-primary">{a.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <AccessGate
          title="Step into the live workspace"
          subtitle="Sign in or request access to open your own command surface — real tasks, real approvals, your mandate."
        />
      </div>
    </section>
  );
}
