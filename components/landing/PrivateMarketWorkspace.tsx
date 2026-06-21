import {
  TASK_GRAPH,
  TWIN_AGENTS,
  TWIN_DISTRICTS,
  type SignalColor,
  type TwinAgent,
} from "@/lib/private-market-workspace";

const COMMANDS = [
  "Find acquisition targets",
  "Raise capital",
  "Build investor pipeline",
  "Source acquisition financing",
  "Prepare lender package",
];

const OUTCOMES = [
  "143 acquisition targets sourced",
  "21 qualified opportunities identified",
  "4 lender introductions generated",
  "Financing package completed",
  "Investor update drafted",
];

const ROUTES: Array<{ x1: number; y1: number; x2: number; y2: number; signal: SignalColor }> = [
  { x1: 50, y1: 48, x2: 50, y2: 16, signal: "green" },
  { x1: 50, y1: 48, x2: 19, y2: 24, signal: "gold" },
  { x1: 50, y1: 48, x2: 19, y2: 48, signal: "blue" },
  { x1: 50, y1: 48, x2: 20, y2: 73, signal: "navy" },
  { x1: 50, y1: 48, x2: 81, y2: 24, signal: "green" },
  { x1: 50, y1: 48, x2: 82, y2: 48, signal: "gold" },
  { x1: 50, y1: 48, x2: 82, y2: 74, signal: "blue" },
  { x1: 50, y1: 48, x2: 50, y2: 79, signal: "navy" },
];

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
    gold: "border-[#f8c86a]/45 bg-[#f8c86a]/10",
    blue: "border-[#59c7ff]/45 bg-[#59c7ff]/10",
    green: "border-[#76ff8a]/45 bg-[#76ff8a]/10",
    navy: "border-[#8aa8ff]/45 bg-[#8aa8ff]/10",
  }[signal];
}

function signalFill(signal: SignalColor): string {
  return {
    gold: "bg-[#f8c86a]",
    blue: "bg-[#25d9ff]",
    green: "bg-[#39ff7a]",
    navy: "bg-[#5b76ff]",
  }[signal];
}

function signalStroke(signal: SignalColor): string {
  return {
    gold: "rgba(248, 200, 106, 0.24)",
    blue: "rgba(37, 217, 255, 0.24)",
    green: "rgba(57, 255, 122, 0.24)",
    navy: "rgba(91, 118, 255, 0.24)",
  }[signal];
}

function AgentSprite({ agent }: { agent: TwinAgent }) {
  const isEarn = agent.name === "Earn";
  return (
    <div
      className="absolute z-20 flex flex-col items-center gap-1"
      style={{
        left: `${agent.x}%`,
        top: `${agent.y}%`,
        transform: "translate(-50%, -50%)",
      }}
      aria-label={`${agent.name}, ${agent.title}`}
    >
      <span
        className={`relative grid ${isEarn ? "h-14 w-14" : "h-11 w-11"} place-items-center rounded-[0.65rem] border ${
          signalBorder(agent.signal)
        } ${signalText(agent.signal)}`}
      >
        {isEarn ? (
          <span className="absolute -inset-3 rounded-full border border-[#f8c86a]/30 bg-[#f8c86a]/10 blur-[1px]" />
        ) : null}
        <span className="absolute left-2 top-2 h-2 w-2 bg-current" />
        <span className="absolute right-2 top-2 h-2 w-2 bg-current" />
        <span className="absolute bottom-2 left-1/2 h-2 w-5 -translate-x-1/2 bg-current" />
        <span className="relative font-mono text-[11px] font-bold text-fg-primary">
          {agent.name === "Earn" ? "E" : agent.name.slice(0, 1)}
        </span>
      </span>
      <span className="max-w-[78px] rounded-full border border-line bg-surface-0/85 px-2 py-0.5 text-[9px] font-semibold text-fg-primary">
        {agent.name.replace(" Agent", "")}
      </span>
    </div>
  );
}

export function PrivateMarketWorkspace() {
  return (
    <section id="earn-action" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-8 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-gold-400">
          Earn workspace map
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
          See how Earn organizes private-market execution.
        </h2>
        <p className="mt-4 text-fg-secondary">
          The workspace maps the operator command, approval context, executive agents,
          task graph, and expected outcomes without suggesting work is running.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.72fr_1.56fr_0.72fr]">
        <div className="rounded-[1.5rem] border border-line bg-surface-1/80 shadow-[0_24px_70px_-48px_rgb(0_0_0/0.9)]">
          <div className="border-b border-line px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
              Operator Brief
            </p>
            <p className="mt-1 text-sm text-fg-secondary">Private-market objectives in plain language.</p>
          </div>

          <div className="space-y-4 p-4">
            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <p className="text-sm font-semibold text-fg-primary">Example Objective</p>
              <p className="mt-3 rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary">
                Find acquisition targets, source financing, and prepare lender materials.
              </p>
            </div>

            <div className="space-y-2">
              {COMMANDS.map((command) => (
                <div
                  key={command}
                  className="rounded-xl border border-line bg-surface-0 px-3 py-2 text-xs text-fg-secondary"
                >
                  {command}
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-line bg-surface-0 p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Approval Context
              </p>
              <p className="mt-2 text-xs leading-relaxed text-fg-secondary">
                Earn structures the work before anything leaves the operator&apos;s control:
                plan, assignment, approval gate, and outcome review.
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[1.5rem] border border-line bg-[#050a12] shadow-[0_24px_90px_-54px_rgb(var(--fx-accent-rgb)/0.85)]">
          <div className="flex items-start justify-between gap-4 border-b border-line bg-surface-0/70 px-4 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold-400">
                Earn Operating Map
              </p>
              <p className="mt-1 text-sm font-medium text-fg-primary">Workspace Structure</p>
              <p className="mt-1 max-w-xl text-xs text-fg-muted">
                Executive agents, district responsibilities, and task paths are shown as a static operating map.
              </p>
            </div>
          </div>

          <div className="relative min-h-[660px] overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:28px_28px]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(56,189,248,0.14),transparent_34%)]" />

            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              {ROUTES.map((route) => (
                <line
                  key={`${route.x2}-${route.y2}`}
                  x1={`${route.x1}%`}
                  y1={`${route.y1}%`}
                  x2={`${route.x2}%`}
                  y2={`${route.y2}%`}
                  stroke={signalStroke(route.signal)}
                  strokeWidth={1.5}
                  strokeDasharray="8 10"
                />
              ))}
            </svg>

            {TWIN_DISTRICTS.map((district) => (
              <div
                key={district.name}
                className="absolute rounded-2xl border border-line/80 bg-surface-0/74 p-3 backdrop-blur"
                style={{
                  left: `${district.x}%`,
                  top: `${district.y}%`,
                  width: `${district.w}%`,
                  height: `${district.h}%`,
                }}
              >
                <p className={`font-mono text-[9px] uppercase tracking-wider ${signalText(district.signal)}`}>
                  {district.name}
                </p>
                <p className="mt-2 max-w-[12rem] text-[11px] leading-snug text-fg-secondary">
                  {district.summary}
                </p>
              </div>
            ))}

            <div className="absolute left-[34%] top-[28%] w-[32%] rounded-2xl border border-[#76ff8a]/30 bg-surface-0/72 p-3 opacity-80 backdrop-blur">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#76ff8a]">
                Task Graph
              </p>
              <div className="mt-3 space-y-1.5">
                {TASK_GRAPH.slice(0, 5).map((node) => (
                  <div key={node.title} className="flex items-center gap-2 text-[10px]">
                    <span className={`h-2 w-2 rounded-full ${signalFill(node.signal)}`} />
                    <span className="text-fg-primary">{node.title}</span>
                  </div>
                ))}
              </div>
            </div>

            {TWIN_AGENTS.map((agent) => (
              <AgentSprite key={agent.name} agent={agent} />
            ))}
          </div>

          <div className="border-t border-line bg-surface-0/70 p-4">
            <div className="grid gap-3 sm:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                  Earn
                </p>
                <p className="mt-1 text-sm font-semibold text-fg-primary">Chief Executive Agent</p>
                <p className="mt-1 text-xs text-fg-muted">Executive Operations Center</p>
                <p className="mt-2 text-xs text-fg-secondary">
                  Planning / Orchestration / Delegation / Monitoring / Decision routing
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface-1 px-3 py-2 font-mono text-[10px] text-fg-muted">
                {TWIN_AGENTS.slice(1).map((agent) => (
                  <p key={agent.name}>
                    &gt; {agent.name}: {agent.district}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

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
