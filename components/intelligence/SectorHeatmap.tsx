"use client";

// components/intelligence/SectorHeatmap.tsx
// Sector Heatmap — CB Insights market map clone.
// Visual grid of sectors × deal stages, colored by activity intensity.
import { ACTIVITY_COLORS } from "@/lib/deal-intelligence";
import type { HeatmapCell, ActivityLevel } from "@/lib/deal-intelligence";

interface Props {
  cells: HeatmapCell[];
  sectors: string[];
  stages: string[];
}

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very High",
};

function HeatCell({ cell }: { cell: HeatmapCell | null }) {
  if (!cell) {
    return <div className="h-16 rounded-lg border border-line/30 bg-surface-1/20" />;
  }
  const colors = ACTIVITY_COLORS[cell.activityLevel];
  return (
    <div
      className={`group relative h-16 cursor-pointer rounded-lg border transition hover:scale-[1.02] hover:z-10 ${colors.bg} ${colors.border}`}
      title={`${cell.sector} · ${cell.stage}: ${cell.dealCount} deals`}
    >
      <div className="flex h-full flex-col items-center justify-center gap-0.5 p-1">
        <span className={`font-mono text-sm font-bold ${colors.text}`}>{cell.dealCount}</span>
        {cell.yoyChangePct !== null && cell.yoyChangePct !== undefined && (
          <span className={`font-mono text-[9px] ${cell.yoyChangePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {cell.yoyChangePct >= 0 ? "+" : ""}{cell.yoyChangePct.toFixed(0)}%
          </span>
        )}
      </div>
      {/* Tooltip on hover */}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 rounded-lg border border-line bg-surface-1 px-2 py-1.5 shadow-xl group-hover:block">
        <p className="whitespace-nowrap font-mono text-[10px] text-fg-secondary">
          {ACTIVITY_LABELS[cell.activityLevel]} activity
        </p>
        <p className="whitespace-nowrap font-mono text-[10px] font-semibold text-fg-primary">
          {cell.dealCount} deal{cell.dealCount !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}

export function SectorHeatmap({ cells, sectors, stages }: Props) {
  // Build a lookup map: sector → stage → cell
  const lookup = new Map<string, HeatmapCell>();
  for (const cell of cells) {
    lookup.set(`${cell.sector}||${cell.stage}`, cell);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Legend */}
      <div className="flex items-center gap-4">
        <span className="font-mono text-[10px] text-fg-muted">Activity:</span>
        {(["low", "moderate", "high", "very_high"] as ActivityLevel[]).map((level) => (
          <span key={level} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded border ${ACTIVITY_COLORS[level].bg} ${ACTIVITY_COLORS[level].border}`} />
            <span className="font-mono text-[10px] text-fg-muted">{ACTIVITY_LABELS[level]}</span>
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${stages.length * 100 + 140}px` }}>
          {/* Stage headers */}
          <div className="mb-2 flex" style={{ paddingLeft: "140px" }}>
            {stages.map((stage) => (
              <div key={stage} className="flex-1 px-1 text-center">
                <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {stage.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>

          {/* Rows */}
          {sectors.map((sector) => (
            <div key={sector} className="mb-2 flex items-center gap-0">
              <div className="w-[140px] shrink-0 pr-3 text-right">
                <span className="font-mono text-[10px] text-fg-secondary">{sector}</span>
              </div>
              <div className={`grid flex-1 gap-1`} style={{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }}>
                {stages.map((stage) => (
                  <HeatCell
                    key={stage}
                    cell={lookup.get(`${sector}||${stage}`) ?? null}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
