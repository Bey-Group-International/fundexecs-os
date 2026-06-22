// components/reports/LpReport.tsx — the print-ready LP Report document.
//
// Server component (no "use client", no hooks). Renders a fund-level quarterly
// report: capital summary, performance multiples, portfolio holdings, and a
// capital-activity summary. The only interactive surface is the PrintButton in
// the action row, which is hidden on print. Imports ONLY types from the
// aggregator, so it never transitively pulls in the Supabase server client.
import { PrintButton } from "@/components/PrintButton";
import { Sparkline } from "@/components/execute/Sparkline";
import { DraftLpUpdateButton } from "@/components/reports/DraftLpUpdateButton";
import type { LpReport as LpReportData } from "@/lib/lp-report";

// Net cashflow (distributions − contributions) for the activity net row.
const netCashflow = (a: LpReportData["activity"]) =>
  (a.distributionsTotal ?? 0) - (a.contributionsTotal ?? 0);

// Whole-dollar USD formatter for the report figures.
const usd = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

const mult = (x: number): string => `${(Number.isFinite(x) ? x : 0).toFixed(2)}x`;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gold" | "positive" | "default";
}) {
  const valueClass =
    tone === "gold"
      ? "text-gold-300"
      : tone === "positive"
        ? "text-status-success"
        : "text-fg-primary";
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4">
      <Eyebrow>{label}</Eyebrow>
      <div
        className={`mt-2 font-display text-xl font-semibold tracking-tight ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}

export function LpReport({ report }: { report: LpReportData }) {
  const { capital, multiples, holdings, activity, navSeries, funds } = report;
  const net = netCashflow(activity);

  return (
    <div className="rounded-xl border border-line bg-surface-0 p-6 sm:p-8">
      {/* Action row — hidden on print */}
      <div className="mb-4 flex items-start justify-end gap-3 print:hidden">
        <DraftLpUpdateButton period={report.period} />
        <PrintButton label="Print / Export report" />
      </div>

      {/* Report header */}
      <header className="border-b border-line pb-6">
        <Eyebrow>LP Report</Eyebrow>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          Quarterly Report — {report.period}
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          Generated {formatDate(report.generatedAt)}
          {report.fundCount > 0
            ? ` · ${report.fundCount} fund${report.fundCount === 1 ? "" : "s"}`
            : ""}
        </p>
      </header>

      {!report.hasData ? (
        <div className="mt-6 rounded-lg border border-line bg-surface-1 p-8 text-center">
          <p className="text-sm text-fg-muted">
            No fund or portfolio data yet. Once funds and assets are recorded,
            this report will populate with capital, performance, and holdings.
          </p>
        </div>
      ) : (
        <>
          {/* Capital summary */}
          <section className="mt-6">
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-gold-400">
              Capital Summary
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard label="Committed" value={usd(capital.committed)} />
              <StatCard label="Paid-in" value={usd(capital.paidIn)} />
              <StatCard
                label="Distributed"
                value={usd(capital.distributed)}
                tone="positive"
              />
              <StatCard label="NAV" value={usd(capital.nav)} tone="gold" />
              <StatCard label="Uncalled" value={usd(capital.uncalled)} />
            </div>
          </section>

          {/* Portfolio NAV over time */}
          {navSeries.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-gold-400">
                Portfolio NAV over time
              </h2>
              <div className="rounded-lg border border-line bg-surface-1 p-4">
                <div className="flex items-baseline justify-between">
                  <Eyebrow>NAV trend</Eyebrow>
                  <span className="font-display text-xl font-semibold tracking-tight text-gold-300">
                    {usd(navSeries[navSeries.length - 1].value)}
                  </span>
                </div>
                <Sparkline
                  values={navSeries.map((p) => p.value)}
                  className="mt-3 h-10 w-full"
                />
              </div>
            </section>
          )}

          {/* Per-fund breakdown */}
          {funds.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-gold-400">
                Per-fund Breakdown
              </h2>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-2">
                    <tr className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      <th className="px-4 py-2 font-normal">Fund</th>
                      <th className="px-4 py-2 text-right font-normal">
                        Committed
                      </th>
                      <th className="px-4 py-2 text-right font-normal">
                        Called
                      </th>
                      <th className="px-4 py-2 text-right font-normal">
                        Distributed
                      </th>
                      <th className="px-4 py-2 font-normal">Currency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((f) => (
                      <tr
                        key={f.id}
                        className="border-t border-line text-fg-secondary"
                      >
                        <td className="px-4 py-2 text-fg-primary">{f.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {usd(f.committed)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {usd(f.called)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-400">
                          {usd(f.distributed)}
                        </td>
                        <td className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                          {f.currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Performance multiples */}
          <section className="mt-6">
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-gold-400">
              Performance
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="TVPI" value={mult(multiples.tvpi)} tone="gold" />
              <StatCard label="DPI" value={mult(multiples.dpi)} />
              <StatCard label="RVPI" value={mult(multiples.rvpi)} />
              <StatCard label="MOIC" value={mult(multiples.moic)} tone="gold" />
            </div>
          </section>

          {/* Portfolio holdings */}
          <section className="mt-6">
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-gold-400">
              Portfolio Holdings
            </h2>
            {holdings.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
                No holdings recorded.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-2">
                    <tr className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      <th className="px-4 py-2 font-normal">Asset</th>
                      <th className="px-4 py-2 font-normal">Type</th>
                      <th className="px-4 py-2 text-right font-normal">Cost</th>
                      <th className="px-4 py-2 text-right font-normal">
                        Current value
                      </th>
                      <th className="px-4 py-2 text-right font-normal">MOIC</th>
                      <th className="px-4 py-2 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => (
                      <tr
                        key={h.id}
                        className="border-t border-line text-fg-secondary"
                      >
                        <td className="px-4 py-2 text-fg-primary">{h.name}</td>
                        <td className="px-4 py-2 capitalize">
                          {h.assetType.replace(/_/g, " ")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {usd(h.cost)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-fg-primary">
                          {usd(h.currentValue)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gold-300">
                          {mult(h.moic)}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`font-mono text-[10px] uppercase tracking-wider ${
                              h.exited
                                ? "text-fg-muted"
                                : "text-status-success"
                            }`}
                          >
                            {h.status.replace(/_/g, " ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Capital activity */}
          {activity.contributionsCount + activity.distributionsCount > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-gold-400">
                Capital Activity
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-line bg-surface-1 p-4">
                  <Eyebrow>
                    Contributions · {activity.contributionsCount}
                  </Eyebrow>
                  <div className="mt-2 font-display text-xl font-semibold tracking-tight text-fg-primary">
                    {usd(activity.contributionsTotal)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-surface-1 p-4">
                  <Eyebrow>
                    Distributions · {activity.distributionsCount}
                  </Eyebrow>
                  <div className="mt-2 font-display text-xl font-semibold tracking-tight text-status-success">
                    {usd(activity.distributionsTotal)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-baseline justify-between rounded-lg border border-line bg-surface-2 px-4 py-3">
                <Eyebrow>Net cashflow (distributions − contributions)</Eyebrow>
                <span
                  className={`font-display text-lg font-semibold tracking-tight ${
                    net >= 0 ? "text-emerald-400" : "text-status-danger"
                  }`}
                >
                  {usd(net)}
                </span>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
