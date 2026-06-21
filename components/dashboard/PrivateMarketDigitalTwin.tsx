import Link from "next/link";
import {
  TWIN_AGENTS,
  TWIN_DISTRICTS,
  type SignalColor,
} from "@/lib/private-market-workspace";

interface ActiveAgent {
  name: string;
  color: string;
  count: number;
}

interface PrivateMarketDigitalTwinProps {
  workflows: number;
  deals: number;
  portfolioAssets: number;
  hottestCapital: number;
  pendingGates: number;
  dispatches: number;
  artifacts: number;
  activeAgents: ActiveAgent[];
}

const DISTRICT_LINKS: Record<string, string> = {
  "Executive Operations Center": "/workspace",
  "Intelligence Center": "/graph",
  "Capital Markets Hub": "/capital-map",
  "Deal Flow Center": "/source/deal_pipeline",
  "Diligence Lab": "/run/diligence",
  "Legal & Compliance Wing": "/execute/closing",
  "Relationship Network Center": "/graph",
  "Portfolio Operations Hub": "/execute/asset_management",
  "Marketing Studio": "/build/brand",
};

const GRAPH_STATE = [
  { label: "Deal Graph", href: "/graph", detail: "qualified opportunities" },
  { label: "Capital Graph", href: "/capital-map", detail: "warm capital paths" },
  { label: "Relationship Graph", href: "/graph", detail: "approved intro routes" },
];

function signalStyle(signal: SignalColor): string {
  return {
    gold: "border-gold-400/45 bg-gold-500/10 text-gold-300",
    blue: "border-sky-400/45 bg-sky-400/10 text-sky-300",
    green: "border-emerald-400/45 bg-emerald-400/10 text-emerald-300",
    navy: "border-indigo-300/45 bg-indigo-400/10 text-indigo-200",
  }[signal];
}

export function PrivateMarketDigitalTwin({
  workflows,
  deals,
  portfolioAssets,
  hottestCapital,
  pendingGates,
  dispatches,
  artifacts,
  activeAgents,
}: PrivateMarketDigitalTwinProps) {
  const totalAgentWork = activeAgents.reduce((sum, agent) => sum + agent.count, 0);
  const executionScore = Math.min(
    100,
    42 +
      Math.min(workflows, 8) * 5 +
      Math.min(deals, 8) * 3 +
      Math.min(artifacts, 8) * 2,
  );

  const districtStats: Record<string, string> = {
    "Executive Operations Center": `${workflows} workflows`,
    "Intelligence Center": `${artifacts} artifacts`,
    "Capital Markets Hub": `${hottestCapital} hot paths`,
    "Deal Flow Center": `${deals} deals`,
    "Diligence Lab": `${artifacts} deliverables`,
    "Legal & Compliance Wing": `${pendingGates} gates`,
    "Relationship Network Center": `${dispatches} dispatches`,
    "Portfolio Operations Hub": `${portfolioAssets} assets`,
    "Marketing Studio": `${dispatches} approved sends`,
  };

  return (
    <section className="fx-orbit-card mb-6 p-5 sm:p-6">
      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            Spatial operating twin
          </span>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary sm:text-3xl">
            Earn routes transactions across the Deal, Capital, and Relationship Graphs.
          </h2>
          <p className="mt-2 text-sm leading-6 text-fg-secondary">
            This live command surface shows where execution is happening, which
            executive agents are carrying work, and which approvals must clear
            before anything reaches a counterparty.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl border border-line bg-surface-0/75 px-4 py-3">
            <p className="font-display text-2xl font-semibold text-fg-primary">
              {executionScore}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              Readiness
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface-0/75 px-4 py-3">
            <p className="font-display text-2xl font-semibold text-fg-primary">
              {totalAgentWork}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              Agent load
            </p>
          </div>
          <Link
            href="/workspace"
            className="rounded-2xl border border-gold-500/40 bg-gold-500/10 px-4 py-3 transition hover:bg-gold-500/15"
          >
            <p className="font-display text-2xl font-semibold text-fg-primary">
              {pendingGates}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-gold-300">
              Gates
            </p>
          </Link>
        </div>
      </div>

      <div className="relative z-10 mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="relative hidden aspect-[16/10] overflow-hidden rounded-[2rem] border border-line/80 bg-surface-0/75 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] lg:block">
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
            <line x1="19" y1="24" x2="19" y2="48" stroke="currentColor" strokeWidth="0.16" strokeDasharray="1.4 1.4" />
            <line x1="20" y1="73" x2="82" y2="74" stroke="currentColor" strokeWidth="0.16" strokeDasharray="1.4 1.4" />
          </svg>

          {TWIN_DISTRICTS.map((district) => (
            <Link
              key={district.name}
              href={DISTRICT_LINKS[district.name] ?? "/dashboard"}
              className={`absolute rounded-2xl border px-3 py-2.5 backdrop-blur-sm transition hover:-translate-y-px hover:border-gold-400/60 ${signalStyle(district.signal)}`}
              style={{
                left: `${district.x}%`,
                top: `${district.y}%`,
                width: `${district.w}%`,
                height: `${district.h}%`,
              }}
            >
              <span className="block line-clamp-2 text-xs font-semibold leading-snug text-fg-primary">
                {district.name}
              </span>
              <span className="mt-1 block font-mono text-[9px] uppercase tracking-wider text-current">
                {districtStats[district.name]}
              </span>
            </Link>
          ))}

          {TWIN_AGENTS.map((agent) => (
            <div
              key={agent.name}
              className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
              style={{ left: `${agent.x}%`, top: `${agent.y}%` }}
            >
              <span className={`h-4 w-4 rounded-full border-2 bg-surface-0 shadow-[0_0_18px_currentColor] ${signalStyle(agent.signal)}`} />
              <span className="rounded-full border border-line/80 bg-surface-0/90 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary">
                {agent.name}
              </span>
            </div>
          ))}
        </div>

        <div className="grid gap-3 lg:hidden">
          {TWIN_DISTRICTS.map((district) => (
            <Link
              key={district.name}
              href={DISTRICT_LINKS[district.name] ?? "/dashboard"}
              className={`rounded-2xl border p-4 ${signalStyle(district.signal)}`}
            >
              <span className="block text-sm font-semibold text-fg-primary">
                {district.name}
              </span>
              <span className="mt-1 block text-xs text-current">
                {districtStats[district.name]}
              </span>
            </Link>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-line bg-surface-0/75 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Graph marketplaces
            </p>
            <div className="mt-3 space-y-2">
              {GRAPH_STATE.map((graph, index) => {
                const values = [deals, hottestCapital, dispatches];
                return (
                  <Link
                    key={graph.label}
                    href={graph.href}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-1/70 px-3 py-2 transition hover:border-gold-500/40"
                  >
                    <span className="font-display text-xl font-semibold text-fg-primary">
                      {values[index]}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-fg-primary">
                        {graph.label}
                      </span>
                      <span className="block truncate text-[11px] text-fg-muted">
                        {graph.detail}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface-0/75 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Executive bench
            </p>
            <div className="mt-3 space-y-2">
              {activeAgents.length === 0 ? (
                <p className="text-xs text-fg-muted">
                  No active assignments. Earn is waiting for the next mandate.
                </p>
              ) : (
                activeAgents.slice(0, 5).map((agent) => (
                  <div key={agent.name} className="flex items-center gap-2 rounded-xl border border-line bg-surface-1/70 px-3 py-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: agent.color, boxShadow: `0 0 8px ${agent.color}` }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-primary">
                      {agent.name}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {agent.count} active
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
