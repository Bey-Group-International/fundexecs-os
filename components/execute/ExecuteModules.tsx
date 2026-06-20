import { createServerClient } from "@/lib/supabase/server";
import { getExecutePerformance, isExited } from "@/lib/execute-performance";
import { compactUsd, multiple, num } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile } from "@/components/execute/ui";
import type { Asset, Artifact } from "@/lib/supabase/database.types";

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
  const { data } = await supabase.from("assets").select("*").eq("organization_id", orgId);
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
    </div>
  );
}
