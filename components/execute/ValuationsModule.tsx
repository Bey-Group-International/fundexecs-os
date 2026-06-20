import { createServerClient } from "@/lib/supabase/server";
import { getExecutePerformance, isExited } from "@/lib/execute-performance";
import { compactUsd, usd, multiple, num } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile, EarnAction } from "@/components/execute/ui";
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
  const [perf, assetsRes] = await Promise.all([
    getExecutePerformance(orgId),
    supabase.from("assets").select("*").eq("organization_id", orgId).order("current_value", { ascending: false, nullsFirst: false }),
  ]);
  const held = ((assetsRes.data ?? []) as Asset[]).filter((a) => !isExited(a.status));

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

      <div className="mb-4 flex flex-wrap gap-2">
        <EarnAction kind="valuation_run" label="Run valuation pass" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/80 text-left">
              {["Holding", "Type", "Cost", "Fair value", "Gain", "MOIC", "Yield", ""].map((h, i) => (
                <th
                  key={h || "act"}
                  className={`whitespace-nowrap px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted ${i >= 2 && i <= 6 ? "text-right" : ""}`}
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
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <EarnAction kind="valuation_asset" label="Re-mark" subject={a.name} subtle />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
