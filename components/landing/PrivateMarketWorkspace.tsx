import {
  TASK_GRAPH,
  type SignalColor,
} from "@/lib/private-market-workspace";

const OUTCOMES = [
  "143 acquisition targets sourced",
  "21 qualified opportunities identified",
  "4 lender introductions generated",
  "Financing package completed",
  "Investor update drafted",
];

function signalText(signal: SignalColor): string {
  return {
    gold: "text-[#f8c86a]",
    blue: "text-[#59c7ff]",
    green: "text-[#76ff8a]",
    navy: "text-[#8aa8ff]",
  }[signal];
}

export function PrivateMarketWorkspace() {
  return (
    <section id="earn-action" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-8 max-w-3xl">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          See how Earn organizes private-market execution.
        </h2>
        <p className="mt-4 text-fg-secondary">
          The execution plan keeps objectives, approval context, task assignments,
          and expected outcomes visible before work starts.
        </p>
      </div>

      <div className="mx-auto grid max-w-md gap-4">
        <div className="rounded-[1.5rem] border border-line bg-surface-1/80 shadow-[0_24px_70px_-48px_rgb(0_0_0/0.9)]">
          <div className="border-b border-line px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
              Execution Plan + Task Graph
            </p>
            <p className="mt-1 text-sm text-fg-secondary">Acquire Manufacturing Company</p>
          </div>

          <div className="space-y-4 p-4">
            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Structure
                </p>
                <span className="rounded-full border border-line bg-surface-1 px-2 py-0.5 font-mono text-[10px] uppercase text-fg-secondary">
                  Mapped
                </span>
              </div>
              <p className="mt-3 text-sm font-semibold text-fg-primary">Operator-reviewed plan</p>
              <p className="mt-2 text-xs text-fg-muted">
                Earn keeps objectives, assignments, approval gates, and outputs visible before work starts.
              </p>
            </div>

            <div className="space-y-2">
              {TASK_GRAPH.map((node) => (
                <div
                  key={node.title}
                  className="rounded-xl border border-line bg-surface-0 px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-fg-primary">{node.title}</p>
                    <span className={`font-mono text-[9px] uppercase ${signalText(node.signal)}`}>
                      mapped
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-muted">{node.agent}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Results Panel
              </p>
              <div className="mt-3 space-y-2">
                {OUTCOMES.map((outcome) => (
                  <p
                    key={outcome}
                    className="text-xs text-fg-muted"
                  >
                    - {outcome}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
