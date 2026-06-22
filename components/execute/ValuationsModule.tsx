import { createServerClient } from "@/lib/supabase/server";
import { getExecutePerformance, isExited } from "@/lib/execute-performance";
import { getValuationMarks, summarizeMarks } from "@/lib/valuation-history";
import { assetSeries, portfolioSeries } from "@/lib/valuation-series";
import { assessValuationPolicy } from "@/lib/valuation-policy";
import { compactUsd, usd, multiple, num, shortDate } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile, EarnAction } from "@/components/execute/ui";
import { Sparkline } from "@/components/execute/Sparkline";
import RecordMarkForm from "@/components/execute/RecordMarkForm";
import { RecordLifecycleActions } from "@/components/RecordLifecycleActions";
import type { Asset } from "@/lib/supabase/database.types";

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

function mark(a: Asset): number | null {
  const c = num(a.acquisition_cost);
  const v = num(a.current_value);
  return c > 0 && v > 0 ? Math.round((v / c) * 100) / 100 : null;
}

// Execute › Valuations: the fair-value workstation. Current marks across the
// held book, the value created over cost, and the Analyst on tap to re-mark the
// portfolio or any single holding.
export async function ExecuteValuationsModule({ orgId }: { orgId: string }) {
  const supabase = createServerClient();
  const [perf, assetsRes, marks] = await Promise.all([
    getExecutePerformance(orgId),
    supabase
      .from("assets")
      .select("*")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("current_value", { ascending: false, nullsFirst: false }),
    getValuationMarks(orgId),
  ]);
  const allAssets = (assetsRes.data ?? []) as Asset[];
  const held = allAssets.filter((a) => !isExited(a.status));
  const markByAsset = summarizeMarks(marks);
  const nameById = new Map(allAssets.map((a) => [a.id, a.name]));
  const portfolio = portfolioSeries(held, marks);
  const portfolioGain =
    portfolio.length >= 2 ? portfolio[portfolio.length - 1].value - portfolio[0].value : 0;
  const policy = assessValuationPolicy(held, marks);

  const header = (
    <ModuleHeader title="Valuations" blurb="Fair-value marks across the book — value created, and the Analyst to re-mark it." />
  );

  if (held.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          note="No held positions to value yet. Add holdings with a cost and current value, then run a valuation pass."
          href="/execute/asset_management"
          cta="Asset management"
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile value={compactUsd(perf.nav)} label="fair value (NAV)" />
        <StatTile value={compactUsd(perf.cost)} label="cost basis" />
        <StatTile
          value={`${perf.unrealizedGain >= 0 ? "+" : "−"}${compactUsd(Math.abs(perf.unrealizedGain))}`}
          label="value created"
          tone={perf.unrealizedGain >= 0 ? "good" : "bad"}
        />
        <StatTile
          value={multiple(perf.grossMoic)}
          label="gross MOIC"
          tone={perf.grossMoic == null ? undefined : perf.grossMoic >= 1 ? "good" : "bad"}
        />
      </div>

      {/* Portfolio value over time */}
      {portfolio.length >= 2 ? (
        <div className="mb-4 rounded-2xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Portfolio value over time
            </span>
            <span
              className={`font-mono text-[11px] ${portfolioGain >= 0 ? "text-emerald-300" : "text-status-danger"}`}
            >
              {portfolioGain >= 0 ? "+" : "−"}
              {compactUsd(Math.abs(portfolioGain))} since {shortDate(portfolio[0].date)}
            </span>
          </div>
          <Sparkline values={portfolio.map((p) => p.value)} width={600} height={56} className="mt-3 h-14 w-full" />
          <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-muted">
            <span>{shortDate(portfolio[0].date)} · {compactUsd(portfolio[0].value)}</span>
            <span>{shortDate(portfolio[portfolio.length - 1].date)} · {compactUsd(portfolio[portfolio.length - 1].value)}</span>
          </div>
        </div>
      ) : null}

      {/* Valuation policy — 409A-style freshness discipline over the marks */}
      <div className="mb-4 rounded-xl border border-line bg-surface-1 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            Valuation policy
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            quarterly · {policy.cadenceDays}d cadence
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="text-fg-secondary">
            <span className="text-fg-primary">{policy.coveragePct}%</span> marked ({policy.markedCount}/{policy.total})
          </span>
          <span className={policy.staleCount > 0 ? "text-status-danger" : "text-emerald-300"}>
            {policy.staleCount > 0 ? `${policy.staleCount} stale / unmarked` : "all current"}
          </span>
          {policy.methods.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {policy.methods.map((m) => (
                <span key={m.method} className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-fg-secondary">
                  {m.method} ×{m.count}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {policy.staleCount > 0 ? (
          <p className="mt-2 font-mono text-[11px] text-fg-muted">
            Oldest:{" "}
            {policy.assets
              .filter((a) => a.stale)
              .slice(0, 3)
              .map((a) => `${a.name} (${a.daysSince == null ? "never" : `${a.daysSince}d`})`)
              .join(" · ")}
          </p>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <EarnAction kind="valuation_run" label="Run valuation pass" />
      </div>

      <RecordMarkForm assets={held.map((a) => ({ id: a.id, name: a.name }))} />

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/80 text-left">
              {["Holding", "Type", "Cost", "Fair value", "Gain", "MOIC", "Yield", "Marks", ""].map((h, i) => (
                <th
                  key={h || "act"}
                  className={`whitespace-nowrap px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted ${i >= 2 && i <= 7 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {held.map((a) => {
              const m = mark(a);
              const gain = num(a.current_value) - num(a.acquisition_cost);
              const hasCost = num(a.acquisition_cost) > 0;
              const yieldPct =
                num(a.current_value) > 0 && num(a.noi) > 0
                  ? Math.round((num(a.noi) / num(a.current_value)) * 1000) / 10
                  : a.cap_rate != null
                    ? num(a.cap_rate)
                    : null;
              return (
                <tr key={a.id} className="border-b border-line/50 bg-surface-1 last:border-0">
                  <td className="whitespace-nowrap px-3 py-3 font-medium text-fg-primary">{a.name}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-fg-secondary">{humanize(a.asset_type)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">
                    {a.acquisition_cost ? usd(a.acquisition_cost) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-primary">
                    {a.current_value ? usd(a.current_value) : "—"}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 text-right font-mono ${
                      !hasCost ? "text-fg-muted" : gain >= 0 ? "text-emerald-300" : "text-status-danger"
                    }`}
                  >
                    {hasCost ? `${gain >= 0 ? "+" : "−"}${usd(Math.abs(gain))}` : "—"}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-3 text-right font-mono ${
                      m == null ? "text-fg-muted" : m >= 1 ? "text-emerald-300" : "text-status-danger"
                    }`}
                  >
                    {multiple(m)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">
                    {yieldPct != null ? `${yieldPct}%` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {(() => {
                      const series = assetSeries(a, marks.filter((m) => m.asset_id === a.id));
                      const s = markByAsset.get(a.id);
                      return (
                        <div className="flex items-center justify-end gap-2">
                          {series.length >= 2 ? <Sparkline values={series.map((p) => p.value)} className="h-6 w-20" /> : null}
                          <span className="font-mono text-[11px] text-fg-muted">{s ? s.count : "—"}</span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <EarnAction kind="valuation_asset" label="Re-mark" subject={a.name} subtle />
                      <RecordLifecycleActions
                        hub="execute"
                        module="valuations"
                        table="assets"
                        id={a.id}
                        deleteClassName=""
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Audit trail */}
      {marks.length > 0 ? (
        <>
          <h3 className="mb-3 mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
            Valuation audit trail
          </h3>
          <div className="overflow-hidden rounded-xl border border-line">
            {marks.slice(0, 12).map((m, i) => (
              <div
                key={m.id}
                className={`flex items-center gap-3 bg-surface-1 px-4 py-2.5 text-sm ${i > 0 ? "border-t border-line/50" : ""}`}
              >
                <span className="w-24 shrink-0 font-mono text-[11px] text-fg-muted">{shortDate(m.as_of)}</span>
                <span className="min-w-0 flex-1 truncate text-fg-primary">{nameById.get(m.asset_id) ?? "—"}</span>
                {m.method ? <span className="hidden shrink-0 font-mono text-[10px] text-fg-muted sm:block">{m.method}</span> : null}
                <span className="shrink-0 font-mono text-fg-secondary">{usd(num(m.value))}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
