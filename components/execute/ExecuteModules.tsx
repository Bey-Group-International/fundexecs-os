import { createServerClient } from "@/lib/supabase/server";
import { getExecutePerformance, isExited } from "@/lib/execute-performance";
import { getTaxAllocation } from "@/lib/tax-allocation";
import { scenarioGrid } from "@/lib/exit-scenarios";
import { DEFAULT_TERMS } from "@/lib/waterfall";
import { compactUsd, usd, multiple, num } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile, EarnAction } from "@/components/execute/ui";
import type { Asset, Artifact } from "@/lib/supabase/database.types";

// A typical hold for annualizing exit-scenario returns, when no per-asset hold
// period is on the book. Labeled in the UI so the assumption is explicit.
const ASSUMED_HOLD_YEARS = 5;

// Closing, Capital Events, and Asset Management each have their own module file;
// this one carries the remaining derived Execute views: Reporting and Exit.

// --- Reporting: the live portfolio report ------------------------------------
// A standing LP-grade snapshot synthesized from the operating record (the same
// roll-up the command center reads), plus the library of reports already drafted.
function ReportLine({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/50 py-2 last:border-0">
      <span className="text-sm text-fg-secondary">{label}</span>
      <span className="flex items-baseline gap-2">
        {sub ? <span className="font-mono text-[10px] text-fg-muted">{sub}</span> : null}
        <span className="font-mono text-sm text-fg-primary">{value}</span>
      </span>
    </div>
  );
}

const REPORT_TYPES = ["lp_update", "summary", "analysis", "memo"] as const;

export async function ExecuteReportingModule({ orgId }: { orgId: string }) {
  const supabase = createServerClient();
  const [perf, artifactsRes] = await Promise.all([
    getExecutePerformance(orgId),
    supabase
      .from("artifacts")
      .select("*")
      .eq("organization_id", orgId)
      .in("artifact_type", REPORT_TYPES)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);
  const reports = (artifactsRes.data ?? []) as Artifact[];

  if (!perf.hasData) {
    return (
      <div>
        <ModuleHeader
          title="Reporting"
          blurb="A live portfolio snapshot for LP letters — and a home for the reports you draft."
          module="reporting"
        />
        <EmptyState
          note="No portfolio to report on yet. Add holdings and log capital, and a live LP-grade snapshot will assemble here."
          href="/execute/asset_management"
          cta="Asset management"
        />
      </div>
    );
  }

  const taxYear = new Date().getFullYear();
  const tax = await getTaxAllocation(orgId, taxYear);

  return (
    <div>
      <ModuleHeader
        title="Reporting"
        blurb="A live portfolio snapshot for LP letters — and a home for the reports you draft."
        module="reporting"
      />

      {/* Live snapshot — the numbers a quarterly letter leads with */}
      <div className="rounded-2xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            Portfolio snapshot
          </span>
          <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
            {perf.stage.label}
          </span>
        </div>
        <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <div>
            <ReportLine label="Net asset value" value={compactUsd(perf.nav)} />
            <ReportLine
              label="Unrealized gain"
              value={`${perf.unrealizedGain >= 0 ? "+" : "−"}${compactUsd(Math.abs(perf.unrealizedGain))}`}
            />
            <ReportLine label="Committed" value={compactUsd(perf.committed)} />
            <ReportLine label="Paid-in (called)" value={compactUsd(perf.called)} />
            <ReportLine label="Distributed" value={compactUsd(perf.distributed)} />
          </div>
          <div>
            <ReportLine label="TVPI" value={multiple(perf.tvpi)} sub="total value / paid-in" />
            <ReportLine label="DPI" value={multiple(perf.dpi)} sub="distributed / paid-in" />
            <ReportLine label="RVPI" value={multiple(perf.rvpi)} sub="residual / paid-in" />
            <ReportLine label="Gross MOIC" value={multiple(perf.grossMoic)} sub="value / cost" />
            <ReportLine
              label="Holdings"
              value={`${perf.activeAssets} held`}
              sub={perf.exitedAssets > 0 ? `${perf.exitedAssets} exited` : undefined}
            />
          </div>
        </div>
      </div>

      {/* Tax allocation (K-1) — per-LP allocation of the year's taxable items
          and the tax capital roll-forward. The income pool is estimated from the
          operating record; labeled so a fund administrator reviews before filing. */}
      {tax.holderCount > 0 ? (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              Tax allocation (K-1) · {tax.year}
            </h3>
            <EarnAction kind="tax_k1" label="Prepare K-1s with Earn" subtle />
          </div>
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm">
            <span className="text-fg-secondary">
              Net taxable <span className="font-mono text-fg-primary">{usd(tax.netTaxable)}</span>
            </span>
            <span className="text-fg-secondary">
              Ordinary <span className="font-mono text-fg-primary">{usd(tax.items.ordinaryIncome)}</span>
            </span>
            <span className="text-fg-secondary">
              LT gain <span className="font-mono text-fg-primary">{usd(tax.items.longTermGain)}</span>
            </span>
            <span className="text-fg-secondary">
              Expenses <span className="font-mono text-fg-primary">{usd(tax.items.expenses)}</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">estimated · review before filing</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/80 text-left">
                  {["Holder", "Own %", "Ordinary", "LT gain", "Expenses", "Net allocated", "Ending capital"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`whitespace-nowrap px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted ${i >= 1 ? "text-right" : ""}`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {tax.allocations.map((a) => (
                  <tr key={a.investorId} className="border-b border-line/50 bg-surface-1 last:border-0">
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-fg-primary">{a.name}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-gold-300">{a.ownershipPct}%</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{usd(a.ordinaryIncome)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{usd(a.longTermGain)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{usd(a.expenses)}</td>
                    <td
                      className={`whitespace-nowrap px-3 py-3 text-right font-mono ${a.netAllocated >= 0 ? "text-emerald-300" : "text-status-danger"}`}
                    >
                      {usd(a.netAllocated)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-primary">{usd(a.endingCapital)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Report library */}
      <h3 className="mb-3 mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
        Reports drafted
      </h3>
      {reports.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-6 text-center text-sm text-fg-secondary">
          No reports yet. Use{" "}
          <span className="text-gold-300">✶ Draft with Earn</span> above to generate an LP update from
          this live snapshot.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {reports.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center gap-3 px-4 py-3 bg-surface-1 ${i > 0 ? "border-t border-line/50" : ""}`}
            >
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                {r.artifact_type.replace("_", " ")}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">{r.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                {r.created_at.slice(0, 10)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Exit: the realized record + harvest candidates --------------------------
// Closes the loop on the portfolio: what's been realized and at what multiple,
// and which held positions are carrying the strongest marks (the natural next
// harvests). Every exit logged feeds DPI in the command center.
export async function ExecuteExitModule({ orgId }: { orgId: string }) {
  const supabase = createServerClient();
  const [{ data }, perf] = await Promise.all([
    supabase.from("assets").select("*").eq("organization_id", orgId),
    getExecutePerformance(orgId),
  ]);
  const assets = (data ?? []) as Asset[];

  if (assets.length === 0) {
    return (
      <div>
        <ModuleHeader title="Exit" blurb="Realized outcomes and the held positions ripest to harvest." />
        <EmptyState
          note="No holdings on the book yet. Add assets in asset management and their exits will be tracked here."
          href="/execute/asset_management"
          cta="Asset management"
        />
      </div>
    );
  }

  const withMultiple = (a: Asset): number | null => {
    const c = num(a.acquisition_cost);
    const v = num(a.current_value);
    return c > 0 && v > 0 ? Math.round((v / c) * 100) / 100 : null;
  };

  const exited = assets.filter((a) => isExited(a.status));
  const held = assets.filter((a) => !isExited(a.status));

  const realizedValue = exited.reduce((s, a) => s + num(a.current_value), 0);
  const realizedCost = exited.reduce((s, a) => s + num(a.acquisition_cost), 0);
  const realizedMoic = realizedCost > 0 ? Math.round((realizedValue / realizedCost) * 100) / 100 : null;

  const candidates = held
    .map((a) => ({ a, m: withMultiple(a) }))
    .filter((x) => x.m != null)
    .sort((x, y) => (y.m as number) - (x.m as number))
    .slice(0, 5);

  exited.sort((a, b) => (withMultiple(b) ?? 0) - (withMultiple(a) ?? 0));

  // Exit scenario sweep — run a grid of exit values through the waterfall so the
  // payoff curve (gross vs LP-net, and where LPs clear their pref) is visible.
  const scenarios =
    perf.cost > 0
      ? scenarioGrid(perf.cost, perf.nav, ASSUMED_HOLD_YEARS, perf.called, DEFAULT_TERMS)
      : [];

  return (
    <div>
      <ModuleHeader title="Exit" blurb="Realized outcomes and the held positions ripest to harvest." />

      <div className="mb-5 grid grid-cols-3 gap-2.5">
        <StatTile value={String(exited.length)} label="realized" />
        <StatTile value={compactUsd(realizedValue)} label="realized value" />
        <StatTile
          value={multiple(realizedMoic)}
          label="realized MOIC"
          tone={realizedMoic == null ? undefined : realizedMoic >= 1 ? "good" : "bad"}
        />
      </div>

      {exited.length > 0 ? (
        <>
          <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
            Realized exits
          </h3>
          <div className="mb-6 overflow-hidden rounded-xl border border-line">
            {exited.map((a, i) => {
              const m = withMultiple(a);
              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-3 px-4 py-3 bg-surface-1 ${i > 0 ? "border-t border-line/50" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">{a.name}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {a.asset_type.replace(/_/g, " ")}
                  </span>
                  <span className="shrink-0 font-mono text-sm text-fg-secondary">
                    {compactUsd(num(a.current_value))}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-sm ${
                      m == null ? "text-fg-muted" : m >= 1 ? "text-emerald-300" : "text-status-danger"
                    }`}
                  >
                    {multiple(m)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="mb-6 rounded-xl border border-dashed border-line bg-surface-1 px-4 py-6 text-center text-sm text-fg-secondary">
          No exits realized yet — mark a holding as exited in asset management to start the realized record.
        </p>
      )}

      {candidates.length > 0 ? (
        <>
          <h3 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
            Held — ripest to harvest
          </h3>
          <div className="flex flex-col gap-2.5">
            {candidates.map(({ a, m }) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg-primary">{a.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {a.asset_type.replace(/_/g, " ")} · {compactUsd(num(a.current_value))} mark
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono text-sm ${
                    (m as number) >= 1 ? "text-emerald-300" : "text-status-danger"
                  }`}
                >
                  {multiple(m)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Exit scenario modeling — gross vs LP-net across a sweep of exit values */}
      {scenarios.length > 0 ? (
        <>
          <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
              Exit scenarios — portfolio
            </h3>
            <EarnAction kind="exit_model" label="Model exits with Earn" subtle />
          </div>
          <p className="mb-3 font-mono text-[10px] text-fg-muted">
            On {compactUsd(perf.cost)} cost · {compactUsd(perf.called)} paid-in · {ASSUMED_HOLD_YEARS}y hold ·
            {" "}
            {Math.round(DEFAULT_TERMS.prefRate * 100)}% pref / {Math.round(DEFAULT_TERMS.carry * 100)}% carry
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/80 text-left">
                  {["Scenario", "Exit value", "Gross MOIC", "To LPs", "To GP", "LP net MOIC", "Gross IRR", "LP IRR"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`whitespace-nowrap px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted ${i >= 1 ? "text-right" : ""}`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => {
                  const isMark = s.label === "Current mark";
                  return (
                    <tr
                      key={s.label}
                      className={`border-b border-line/50 last:border-0 ${isMark ? "bg-gold-500/5" : "bg-surface-1"}`}
                    >
                      <td className="whitespace-nowrap px-3 py-3 font-medium text-fg-primary">
                        {s.label}
                        {isMark ? (
                          <span className="ml-2 rounded-full border border-gold-500/40 bg-gold-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                            today
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{compactUsd(s.exitValue)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{multiple(s.grossMultiple)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{compactUsd(s.toLps)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-muted">{compactUsd(s.toGp)}</td>
                      <td
                        className={`whitespace-nowrap px-3 py-3 text-right font-mono ${
                          s.lpMultiple == null ? "text-fg-muted" : s.lpMultiple >= 1 ? "text-emerald-300" : "text-status-danger"
                        }`}
                      >
                        {multiple(s.lpMultiple)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">
                        {s.irr == null ? "—" : `${s.irr}%`}
                      </td>
                      <td
                        className={`whitespace-nowrap px-3 py-3 text-right font-mono ${
                          s.lpIrr == null ? "text-fg-muted" : s.lpIrr >= 0 ? "text-emerald-300" : "text-status-danger"
                        }`}
                      >
                        {s.lpIrr == null ? "—" : `${s.lpIrr}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
