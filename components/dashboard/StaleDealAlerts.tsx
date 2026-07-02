"use client";

export interface StaleDeal {
  id: string;
  name: string;
  stage: string;
  daysStale: number;
  lastActivityDate: string | null;
  assignee: string | null;
  dealValue: number | null;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function stalenessColor(days: number): string {
  if (days > 60) return "text-status-danger";
  if (days > 30) return "text-gold-400";
  return "text-fg-muted";
}

function stageBadgeClass(stage: string): string {
  const s = stage.toLowerCase();
  if (s.includes("close") || s.includes("sign")) return "bg-emerald-950 text-emerald-300 border-emerald-800";
  if (s.includes("due") || s.includes("diligen")) return "bg-yellow-950 text-gold-400 border-yellow-800";
  if (s.includes("prospect") || s.includes("sourcing")) return "bg-zinc-800 text-fg-secondary border-zinc-700";
  return "bg-zinc-800 text-fg-secondary border-zinc-700";
}

export function StaleDealAlerts({ deals }: { deals: StaleDeal[] }) {
  const sorted = [...deals].sort((a, b) => b.daysStale - a.daysStale);

  const critical = sorted.filter((d) => d.daysStale > 90).length;
  const high = sorted.filter((d) => d.daysStale > 60 && d.daysStale <= 90).length;
  const medium = sorted.filter((d) => d.daysStale > 30 && d.daysStale <= 60).length;
  const low = sorted.filter((d) => d.daysStale <= 30).length;

  const severityBands = [
    { label: "Critical", sublabel: ">90d", count: critical, color: "text-status-danger", bar: "bg-red-600" },
    { label: "High", sublabel: ">60d", count: high, color: "text-orange-400", bar: "bg-orange-500" },
    { label: "Medium", sublabel: ">30d", count: medium, color: "text-gold-400", bar: "bg-yellow-500" },
    { label: "Low", sublabel: "<30d", count: low, color: "text-fg-muted", bar: "bg-zinc-600" },
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5 flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-mono uppercase tracking-widest text-xs text-fg-muted">Stale Deal Alerts</h2>
        <p className="text-fg-secondary text-sm">PipelineRoad-style pipeline staleness monitor.</p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {severityBands.map((band) => (
          <div key={band.label} className="rounded-xl bg-surface-0 border border-line p-3 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className={`font-mono text-xs uppercase ${band.color}`}>{band.label}</span>
              <span className={`font-mono text-lg font-bold ${band.color}`}>{band.count}</span>
            </div>
            <span className="text-fg-muted text-xs">{band.sublabel}</span>
            <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${band.bar}`}
                style={{ width: deals.length > 0 ? `${(band.count / deals.length) * 100}%` : "0%" }}
              />
            </div>
          </div>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <span className="text-2xl">✓</span>
          <p className="text-fg-muted text-sm font-mono">No stale deals</p>
          <p className="text-fg-muted text-xs">All pipeline deals have recent activity.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-3 pb-1 border-b border-line">
            {["Deal", "Stage", "Days Stale", "Last Activity", "Assignee", "Value"].map((h) => (
              <span key={h} className="font-mono uppercase text-xs text-fg-muted">{h}</span>
            ))}
          </div>
          {sorted.map((deal) => (
            <div
              key={deal.id}
              className="grid sm:grid-cols-[1fr_auto_auto_auto_auto_auto] grid-cols-1 gap-x-4 gap-y-0.5 items-center px-3 py-2.5 rounded-xl hover:bg-surface-0 transition-colors"
            >
              <span className="text-fg-primary text-sm font-medium truncate">{deal.name}</span>
              <span className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-mono ${stageBadgeClass(deal.stage)}`}>
                {deal.stage}
              </span>
              <span className={`font-mono text-sm font-bold tabular-nums ${stalenessColor(deal.daysStale)}`}>
                {deal.daysStale}d
              </span>
              <span className="text-fg-muted text-xs font-mono tabular-nums hidden sm:inline">
                {deal.lastActivityDate ?? "—"}
              </span>
              <span className="text-fg-secondary text-xs hidden sm:inline truncate max-w-[80px]">
                {deal.assignee ?? <span className="text-fg-muted">—</span>}
              </span>
              <span className="text-fg-secondary text-xs font-mono hidden sm:inline">
                {deal.dealValue != null ? fmtUsd(deal.dealValue) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
