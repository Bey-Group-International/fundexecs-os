import {
  TASK_GRAPH,
  TWIN_AGENTS,
  TWIN_DISTRICTS,
  type SignalColor,
} from "@/lib/private-market-workspace";

const OUTCOMES = [
  "143 acquisition targets sourced",
  "21 qualified opportunities identified",
  "4 lender introductions generated",
  "Financing package completed",
  "Investor update drafted",
];

const GRAPH_LAYERS = [
  {
    name: "Deal Graph",
    summary: "Targets, sponsors, SPVs, funds, readiness, and transaction status.",
    metric: "21 qualified opportunities",
  },
  {
    name: "Capital Graph",
    summary: "LPs, family offices, lenders, eligibility, mandates, and check sizes.",
    metric: "$184M matched capacity",
  },
  {
    name: "Relationship Graph",
    summary: "Warm paths, consent state, trust strength, and approved introductions.",
    metric: "9 routed intro paths",
  },
];

const APPROVAL_GATES = [
  { tier: "T1", label: "Internal draft", state: "Auto-cleared" },
  { tier: "T2", label: "External action", state: "Operator sign-off" },
  { tier: "T3", label: "Capital-binding", state: "Never delegable" },
];

const COMMAND_STEPS = ["Command", "Structure", "Match", "Authorize", "Deliver", "Evidence"];

function signalText(signal: SignalColor): string {
  return {
    gold: "text-[#f8c86a]",
    blue: "text-[#59c7ff]",
    green: "text-[#76ff8a]",
    navy: "text-[#8aa8ff]",
  }[signal];
}

function signalBorder(signal: SignalColor): string {
  return {
    gold: "border-gold-400/45 bg-gold-500/10",
    blue: "border-sky-400/45 bg-sky-400/10",
    green: "border-emerald-400/45 bg-emerald-400/10",
    navy: "border-indigo-300/45 bg-indigo-400/10",
  }[signal];
}

export function PrivateMarketWorkspace() {
  return (
    <section id="earn-action" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-8 max-w-4xl">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-gold-400">
          Spatial digital twin
        </p>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          Watch Earn orchestrate the private-market operating network.
        </h2>
        <p className="mt-4 text-fg-secondary">
          A spatial twin turns every instruction into a visible operating system:
          graph matches, executive assignments, approval gates, artifacts, and
          audit-ready records stay connected from mandate to completed transaction.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)]">
        <div className="fx-orbit-card min-h-[640px] p-4 sm:p-6 md:sticky md:top-6 md:max-h-[calc(100vh-3rem)] md:min-h-0 md:self-start md:overflow-y-auto">
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold-400">
                Earn operating campus
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">
                Deal, capital, and relationship graphs in one execution map.
              </h3>
            </div>
            <div className="rounded-2xl border border-gold-500/30 bg-surface-0/75 px-4 py-3 text-right backdrop-blur">
              <p className="font-display text-3xl font-semibold text-fg-primary">82%</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Source confidence
              </p>
            </div>
          </div>

          <div className="relative z-10 mt-6 hidden aspect-[16/11] overflow-hidden rounded-[2rem] border border-line/80 bg-surface-0/70 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] md:block">
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              className="absolute inset-0 h-full w-full text-line/80"
              preserveAspectRatio="none"
            >
              <line x1="50" y1="48" x2="19" y2="24" stroke="currentColor" strokeWidth="0.25" />
              <line x1="50" y1="48" x2="20" y2="73" stroke="currentColor" strokeWidth="0.25" />
              <line x1="50" y1="48" x2="19" y2="48" stroke="currentColor" strokeWidth="0.25" />
              <line x1="50" y1="48" x2="81" y2="24" stroke="currentColor" strokeWidth="0.25" />
              <line x1="50" y1="48" x2="82" y2="74" stroke="currentColor" strokeWidth="0.25" />
              <line x1="50" y1="48" x2="50" y2="79" stroke="currentColor" strokeWidth="0.25" />
              <line x1="19" y1="24" x2="20" y2="73" stroke="currentColor" strokeWidth="0.18" strokeDasharray="1.4 1.4" />
              <line x1="19" y1="24" x2="19" y2="48" stroke="currentColor" strokeWidth="0.18" strokeDasharray="1.4 1.4" />
              <line x1="20" y1="73" x2="82" y2="74" stroke="currentColor" strokeWidth="0.18" strokeDasharray="1.4 1.4" />
            </svg>

            {TWIN_DISTRICTS.map((district) => (
              <div
                key={district.name}
                className={`absolute rounded-2xl border px-3 py-2.5 backdrop-blur-sm ${signalBorder(district.signal)}`}
                style={{
                  left: `${district.x}%`,
                  top: `${district.y}%`,
                  width: `${district.w}%`,
                  height: `${district.h}%`,
                }}
              >
                <p className="line-clamp-2 text-xs font-semibold leading-snug text-fg-primary">
                  {district.name}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-fg-muted">
                  {district.summary}
                </p>
              </div>
            ))}

            {TWIN_AGENTS.map((agent) => (
              <div
                key={agent.name}
                className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                style={{ left: `${agent.x}%`, top: `${agent.y}%` }}
              >
                <span
                  className={`h-4 w-4 rounded-full border-2 bg-surface-0 shadow-[0_0_18px_currentColor] ${signalText(agent.signal)}`}
                />
                <span className="rounded-full border border-line/80 bg-surface-0/85 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary">
                  {agent.name}
                </span>
              </div>
            ))}
          </div>

          <div className="relative z-10 mt-6 grid gap-3 md:hidden">
            {TWIN_DISTRICTS.map((district) => (
              <div key={district.name} className={`rounded-2xl border p-4 ${signalBorder(district.signal)}`}>
                <p className="text-sm font-semibold text-fg-primary">{district.name}</p>
                <p className="mt-1 text-xs text-fg-muted">{district.summary}</p>
              </div>
            ))}
          </div>

          <div className="relative z-10 mt-5 grid gap-3 md:grid-cols-3">
            {GRAPH_LAYERS.map((graph) => (
              <div key={graph.name} className="rounded-2xl border border-line bg-surface-0/70 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                  {graph.name}
                </p>
                <p className="mt-2 text-sm font-medium text-fg-primary">{graph.metric}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{graph.summary}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="fx-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
              Instruction pipeline
            </p>
            <p className="mt-2 text-sm text-fg-secondary">
              Find HVAC companies with $2M-$8M EBITDA. Identify co-investors,
              lender paths, and prepare a financing package.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {COMMAND_STEPS.map((step, index) => (
                <div key={step} className="rounded-xl border border-line bg-surface-0 px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    0{index + 1}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-fg-primary">{step}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="fx-card p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                Executive workforce
              </p>
              <span className="rounded-full border border-status-success/40 bg-status-success/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                Orchestrated
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {TASK_GRAPH.map((node) => (
                <div
                  key={node.title}
                  className="rounded-xl border border-line bg-surface-0 px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-fg-primary">{node.title}</p>
                    <span className={`font-mono text-[9px] uppercase ${signalText(node.signal)}`}>
                      assigned
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-fg-muted">{node.agent}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="fx-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
              Approval gates
            </p>
            <div className="mt-4 space-y-2">
              {APPROVAL_GATES.map((gate) => (
                <div key={gate.tier} className="flex items-center gap-3 rounded-xl border border-line bg-surface-0 px-3 py-2.5">
                  <span className="rounded-full border border-gold-500/40 px-2 py-0.5 font-mono text-[10px] text-gold-400">
                    {gate.tier}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-medium text-fg-primary">
                    {gate.label}
                  </span>
                  <span className="text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    {gate.state}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="fx-card p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
              Completed transaction artifacts
            </p>
            <div className="mt-3 space-y-2">
              {OUTCOMES.map((outcome) => (
                <p key={outcome} className="text-xs text-fg-muted">
                  - {outcome}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
