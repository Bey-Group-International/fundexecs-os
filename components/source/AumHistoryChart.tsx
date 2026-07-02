"use client";

// Fintrx-style AUM history derived from capital events timeline.
// Since we don't store historical AUM snapshots, we derive a running picture
// from commitment dates and called capital — showing how the LP's deployed
// capital with this firm has grown over time.
import type { CommitmentWithFund } from "@/lib/source-war-room";
import type { CapitalEvent } from "@/lib/supabase/database.types";

interface Props {
  investor: { name: string; aum: number | null };
  commitments: CommitmentWithFund[];
  capitalEvents: (CapitalEvent & { commitment_id?: string })[];
}

function fmt(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

interface CapEvt {
  date: string;
  amount: number;
  type: string;
  fund: string | null;
}

export function AumHistoryChart({ investor, commitments, capitalEvents }: Props) {
  // Build a running capital-called timeline from capital events
  const callEvents: CapEvt[] = capitalEvents
    .filter((e) => e.event_type === "capital_call" || e.event_type === "contribution")
    .map((e) => ({
      date: e.effective_date,
      amount: e.amount,
      type: e.event_type,
      fund:
        null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const distEvents: CapEvt[] = capitalEvents
    .filter((e) => e.event_type === "distribution" || e.event_type === "return_of_capital")
    .map((e) => ({
      date: e.effective_date,
      amount: e.amount,
      type: e.event_type,
      fund:
        null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalCalled = callEvents.reduce((s, e) => s + e.amount, 0);
  const totalDistributed = distEvents.reduce((s, e) => s + e.amount, 0);
  const totalCommitted = commitments.reduce((s, c) => s + c.commitment.committed_amount, 0);

  // Build cumulative called series for SVG sparkline
  let running = 0;
  const points = callEvents.map((e) => {
    running += e.amount;
    return running;
  });

  const maxPt = Math.max(...points, 1);
  const W = 280;
  const H = 48;
  const svgPts =
    points.length > 1
      ? points
          .map((v, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${(H - (v / maxPt) * H).toFixed(1)}`)
          .join(" ")
      : null;

  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">
        Capital Deployment
      </h3>

      {/* AUM stat + committed breakdown */}
      <div className="mb-3 flex flex-wrap gap-4">
        {investor.aum !== null && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Reported AUM</p>
            <p className="font-mono text-lg font-bold text-fg-primary">{fmt(investor.aum)}</p>
          </div>
        )}
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Committed (this firm)</p>
          <p className="font-mono text-lg font-bold text-fg-primary">{fmt(totalCommitted)}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Called</p>
          <p className="font-mono text-base font-semibold text-status-danger">{fmt(totalCalled)}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Distributed</p>
          <p className="font-mono text-base font-semibold text-emerald-300">{fmt(totalDistributed)}</p>
        </div>
        {investor.aum !== null && totalCommitted > 0 && (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Concentration</p>
            <p className="font-mono text-base font-semibold text-gold-300">
              {((totalCommitted / investor.aum) * 100).toFixed(1)}%
            </p>
          </div>
        )}
      </div>

      {/* Cumulative called sparkline */}
      {svgPts && (
        <div className="mb-3">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            Cumulative capital called
          </p>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full overflow-visible">
            <defs>
              <linearGradient id="aum-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" className="text-gold-400" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-gold-400" />
              </linearGradient>
            </defs>
            <polygon
              points={`0,${H} ${svgPts} ${W},${H}`}
              fill="url(#aum-grad)"
            />
            <polyline
              points={svgPts}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-gold-400"
            />
          </svg>
          <div className="mt-0.5 flex justify-between font-mono text-[9px] text-fg-muted">
            <span>{callEvents[0]?.date?.slice(0, 7) ?? ""}</span>
            <span>{callEvents[callEvents.length - 1]?.date?.slice(0, 7) ?? ""}</span>
          </div>
        </div>
      )}

      {/* Fund breakdown table */}
      {commitments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line">
                {["Fund", "Committed", "Called", "Distributed", "DPI"].map((h) => (
                  <th
                    key={h}
                    className={`pb-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted ${
                      h === "Fund" ? "text-left" : "text-right"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40">
              {commitments.map(({ commitment: c, fund }) => {
                const dpi = c.called_amount > 0 ? c.distributed_amount / c.called_amount : null;
                return (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-3 font-medium text-fg-primary">
                      {fund?.name ?? "—"}
                    </td>
                    <td className="py-1.5 text-right text-fg-secondary">{fmt(c.committed_amount)}</td>
                    <td className="py-1.5 text-right text-status-danger">{fmt(c.called_amount)}</td>
                    <td className="py-1.5 text-right text-emerald-300">{fmt(c.distributed_amount)}</td>
                    <td className="py-1.5 text-right font-mono text-fg-muted">
                      {dpi !== null ? `${dpi.toFixed(2)}×` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {commitments.length === 0 && callEvents.length === 0 && (
        <p className="text-sm text-fg-muted">
          No capital events recorded for this LP yet.
        </p>
      )}
    </div>
  );
}
