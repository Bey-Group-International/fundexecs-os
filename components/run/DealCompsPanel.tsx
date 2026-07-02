"use client";

import type { DealComp } from "@/lib/deal-comps";

interface Props {
  comps: DealComp[];
}

function fmt(v: number | null, prefix = ""): string {
  if (v === null) return "—";
  if (v >= 1_000_000_000) return `${prefix}${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${prefix}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${prefix}${(v / 1_000).toFixed(0)}K`;
  return `${prefix}${v.toFixed(1)}`;
}

function fmtMultiple(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(1)}×`;
}

function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === "owned" || stage === "closing"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : stage === "exited"
      ? "border-line bg-surface-2 text-fg-muted"
      : "border-gold-500/40 bg-gold-500/10 text-gold-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${tone}`}>
      {stage.replace("_", " ")}
    </span>
  );
}

export function DealCompsPanel({ comps }: Props) {
  if (comps.length === 0) {
    return (
      <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Comparable Transactions
        </h3>
        <p className="text-sm text-fg-muted">
          No comparable deals found. As you work deals through underwriting and closing they will appear here.
        </p>
      </div>
    );
  }

  // Median EV/Revenue and EV/EBITDA across peers (excluding current deal)
  const peers = comps.filter((c) => !c.isCurrent);
  const evRevPeers = peers.map((c) => c.evRevenue).filter((v): v is number => v !== null);
  const evEbPeers = peers.map((c) => c.evEbitda).filter((v): v is number => v !== null);
  const median = (arr: number[]) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const medEvRev = median(evRevPeers);
  const medEvEb = median(evEbPeers);

  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
          Comparable Transactions
        </h3>
        {(medEvRev !== null || medEvEb !== null) && (
          <div className="flex gap-3">
            {medEvRev !== null && (
              <span className="font-mono text-[10px] text-fg-muted">
                Peer EV/Rev median{" "}
                <span className="text-fg-secondary">{fmtMultiple(medEvRev)}</span>
              </span>
            )}
            {medEvEb !== null && (
              <span className="font-mono text-[10px] text-fg-muted">
                EV/EBITDA median{" "}
                <span className="text-fg-secondary">{fmtMultiple(medEvEb)}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="pb-2 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                Deal
              </th>
              <th className="pb-2 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                EV
              </th>
              <th className="pb-2 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                EV / Rev
              </th>
              <th className="pb-2 text-right font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                EV / EBITDA
              </th>
              <th className="pb-2 pl-3 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                Stage
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/40">
            {comps.map((comp) => (
              <tr
                key={comp.id}
                className={comp.isCurrent ? "bg-gold-500/5" : ""}
              >
                <td className="py-2 pr-3">
                  <div className="flex flex-col">
                    <span className={`font-medium ${comp.isCurrent ? "text-gold-300" : "text-fg-primary"}`}>
                      {comp.name}
                      {comp.isCurrent && (
                        <span className="ml-2 font-mono text-[9px] uppercase tracking-wider text-gold-400">
                          ← this deal
                        </span>
                      )}
                    </span>
                    {comp.sector && (
                      <span className="font-mono text-[10px] text-fg-muted">{comp.sector}</span>
                    )}
                  </div>
                </td>
                <td className="py-2 text-right font-mono text-xs text-fg-secondary">
                  {fmt(comp.ev, "$")}
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  <MultipleCmp value={comp.evRevenue} median={medEvRev} />
                </td>
                <td className="py-2 text-right font-mono text-xs">
                  <MultipleCmp value={comp.evEbitda} median={medEvEb} />
                </td>
                <td className="py-2 pl-3">
                  <StageBadge stage={comp.stage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 font-mono text-[9px] text-fg-muted">
        Multiples derived from underwriting entry assumptions across your portfolio.
      </p>
    </div>
  );
}

function MultipleCmp({
  value,
  median,
}: {
  value: number | null;
  median: number | null;
}) {
  if (value === null) return <span className="text-fg-muted">—</span>;
  const above = median !== null && value > median * 1.1;
  const below = median !== null && value < median * 0.9;
  const tone = above
    ? "text-status-danger"
    : below
    ? "text-emerald-300"
    : "text-fg-secondary";
  return <span className={tone}>{fmtMultiple(value)}</span>;
}
