import {
  TWIN_AGENTS,
  TWIN_DISTRICTS,
  type SignalColor,
} from "@/lib/private-market-workspace";

const GRAPH_TILES = [
  {
    label: "Deal Graph",
    metric: "Targets + mandates",
    body: "Opportunities, sponsors, SPVs, funds, diligence stage, and transaction readiness.",
  },
  {
    label: "Capital Graph",
    metric: "LPs + lenders",
    body: "Mandates, check sizes, eligibility, capital stack fit, and communication controls.",
  },
  {
    label: "Relationship Graph",
    metric: "Warm paths + consent",
    body: "Trust paths, introductions, service providers, operators, and disclosure boundaries.",
  },
];

const GATES = [
  ["T1", "Internal draft", "Earn executes"],
  ["T2", "External action", "Operator approval"],
  ["T3", "Capital-binding", "Never delegable"],
] as const;

const OUTCOMES = [
  "Execution plan structured",
  "Graph matches scored",
  "Executive agents assigned",
  "Approval gates surfaced",
  "Artifacts and audit trail preserved",
];

const HUB_SHORTCUTS = ["Build", "Source", "Run", "Execute", "Graphs", "Vault"];

const ACTION_QUEUE = [
  ["Review 4 HVAC targets", "Deal Graph match package", "Now"],
  ["Authorize 2 introductions", "Capital + relationship path", "Gate"],
  ["Prepare financing package", "Memo, lender list, audit record", "Active"],
] as const;

function signalClass(signal: SignalColor): string {
  return {
    gold: "border-gold-400/45 bg-gold-500/10 text-gold-300",
    blue: "border-sky-400/45 bg-sky-400/10 text-sky-300",
    green: "border-emerald-400/45 bg-emerald-400/10 text-emerald-300",
    navy: "border-indigo-300/45 bg-indigo-400/10 text-indigo-200",
  }[signal];
}

export function WorkspaceOperatingSystem({ name }: { name: string }) {
  return (
    <section className="fx-orbit-card mb-6 p-4 sm:p-5">
      <div className="relative z-10 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold-400">
                Earn Command Center
              </p>
              <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary sm:text-3xl">
                Welcome back, {name}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-secondary">
                The workspace is now a spatial digital twin: every mandate routes
                through the Deal Graph, Capital Graph, Relationship Graph,
                executive workforce, gates, artifacts, and audit history.
              </p>
            </div>
            <div className="rounded-2xl border border-gold-500/35 bg-surface-0/75 px-4 py-3 text-right">
              <p className="font-display text-3xl font-semibold text-fg-primary">Live</p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-gold-300">
                Command layer
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {HUB_SHORTCUTS.map((hub) => (
              <span
                key={hub}
                className="rounded-full border border-line bg-surface-0/75 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-secondary"
              >
                {hub}
              </span>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-gold-500/30 bg-gold-500/10 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">
              Current instruction
            </p>
            <p className="mt-2 text-sm font-medium leading-6 text-fg-primary">
              Find HVAC companies with $2M-$8M EBITDA. Identify co-investors,
              lender paths, and prepare financing package.
            </p>
          </div>

          <div className="relative mt-5 hidden aspect-[16/9] overflow-hidden rounded-[2rem] border border-line/80 bg-surface-0/72 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] md:block">
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
              <line x1="19" y1="24" x2="20" y2="73" stroke="currentColor" strokeWidth="0.16" strokeDasharray="1.4 1.4" />
              <line x1="19" y1="48" x2="82" y2="48" stroke="currentColor" strokeWidth="0.16" strokeDasharray="1.4 1.4" />
              <line x1="20" y1="73" x2="82" y2="74" stroke="currentColor" strokeWidth="0.16" strokeDasharray="1.4 1.4" />
            </svg>

            {TWIN_DISTRICTS.map((district) => (
              <div
                key={district.name}
                className={`absolute rounded-2xl border px-3 py-2 backdrop-blur-sm ${signalClass(district.signal)}`}
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
                <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-current">
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
                  className={`h-4 w-4 rounded-full border-2 bg-surface-0 shadow-[0_0_18px_currentColor] ${signalClass(agent.signal)}`}
                />
                <span className="rounded-full border border-line/80 bg-surface-0/90 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary">
                  {agent.name}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-2 md:hidden">
            {TWIN_DISTRICTS.slice(0, 6).map((district) => (
              <div key={district.name} className={`rounded-2xl border p-3 ${signalClass(district.signal)}`}>
                <p className="text-sm font-semibold text-fg-primary">{district.name}</p>
                <p className="mt-1 text-xs text-current">{district.summary}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-surface-0/75 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                Action Queue
              </p>
              <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                Title · Details · Last active
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {ACTION_QUEUE.map(([title, detail, active]) => (
                <div key={title} className="grid gap-2 rounded-xl border border-line bg-surface-1/75 px-3 py-2 text-xs sm:grid-cols-[1fr_1.25fr_auto]">
                  <span className="font-medium text-fg-primary">{title}</span>
                  <span className="text-fg-muted">{detail}</span>
                  <span className="font-mono uppercase tracking-wider text-gold-400">{active}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid gap-2">
            {GRAPH_TILES.map((graph) => (
              <div key={graph.label} className="rounded-2xl border border-line bg-surface-0/75 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                    {graph.label}
                  </p>
                  <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    {graph.metric}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-fg-secondary">{graph.body}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-surface-0/75 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Approval-gated execution
            </p>
            <div className="mt-3 space-y-2">
              {GATES.map(([tier, label, status]) => (
                <div key={tier} className="flex items-center gap-3 rounded-xl border border-line bg-surface-1/75 px-3 py-2">
                  <span className="rounded-full border border-gold-500/40 px-2 py-0.5 font-mono text-[10px] text-gold-400">
                    {tier}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-medium text-fg-primary">{label}</span>
                  <span className="text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gold-500/35 bg-gold-500/10 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">
              Action proposed
            </p>
            <p className="mt-2 text-sm font-medium leading-6 text-fg-primary">
              Send controlled intro to co-investors and lender with approved package only.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <span className="rounded-xl border border-line bg-surface-0/75 px-3 py-2 text-fg-secondary">
                Risk: Tier 2
              </span>
              <span className="rounded-xl border border-line bg-surface-0/75 px-3 py-2 text-fg-secondary">
                External-facing
              </span>
              <span className="rounded-xl border border-line bg-surface-0/75 px-3 py-2 text-fg-secondary">
                No binding terms
              </span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {["Approve", "Edit", "Reject", "Escalate"].map((action) => (
                <span
                  key={action}
                  className="rounded-lg border border-line bg-surface-0/75 px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-fg-secondary"
                >
                  {action}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface-0/75 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Transaction completion loop
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {OUTCOMES.map((outcome) => (
                <p key={outcome} className="rounded-xl border border-line bg-surface-1/75 px-3 py-2 text-xs text-fg-secondary">
                  {outcome}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
