// components/portfolio/PortfolioMonitor.tsx — the portfolio command center view.
//
// A presentational server component (no hooks, no "use client"). It imports only
// types from the aggregator so it never pulls `next/headers` into the bundle.
// Renders a totals strip, an alerts list, and a held-asset table sorted by NAV.
import type {
  PortfolioMonitor as PortfolioMonitorData,
  PortfolioAsset,
  PortfolioAlert,
  AlertTone,
} from "@/lib/portfolio-monitor";

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Format a number (or null) as whole-dollar USD; em-dash for unknowns. */
function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return usdFmt.format(n);
}

/** Signed USD with a leading +/-, for unrealized gain. */
function usdSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${usdFmt.format(Math.abs(n))}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function moicLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}x`;
}

function gainClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-fg-secondary";
  return n > 0 ? "text-emerald-400" : "text-status-danger";
}

const ALERT_TONE: Record<AlertTone, { dot: string; label: string; tag: string }> = {
  warning: {
    dot: "bg-status-warning",
    label: "text-status-warning",
    tag: "Stale mark",
  },
  danger: {
    dot: "bg-status-danger",
    label: "text-status-danger",
    tag: "Write-down risk",
  },
  info: {
    dot: "bg-status-info",
    label: "text-status-info",
    tag: "Underperformer",
  },
};

function TotalCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {label}
      </div>
      <div
        className={`mt-1.5 text-lg font-semibold tabular-nums ${
          valueClass ?? "text-fg-primary"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function TotalsStrip({ data }: { data: PortfolioMonitorData }) {
  const { totals } = data;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <TotalCard label="NAV" value={usd(totals.nav)} />
      <TotalCard label="Cost" value={usd(totals.cost)} />
      <TotalCard
        label="Unrealized gain"
        value={usdSigned(totals.unrealizedGain)}
        valueClass={gainClass(totals.unrealizedGain)}
      />
      <TotalCard label="Weighted MOIC" value={moicLabel(totals.weightedMoic)} />
      <TotalCard label="Held assets" value={String(totals.heldCount)} />
    </div>
  );
}

function AlertRow({ alert }: { alert: PortfolioAlert }) {
  const tone = ALERT_TONE[alert.tone];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-3">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg-primary">
            {alert.assetName}
          </span>
          <span
            className={`font-mono text-[9px] uppercase tracking-wider ${tone.label}`}
          >
            {tone.tag}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-snug text-fg-secondary">
          {alert.message}
        </p>
      </div>
    </div>
  );
}

function AlertsList({ alerts }: { alerts: PortfolioAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
        Alerts
      </h2>
      <div className="flex flex-col gap-2">
        {alerts.map((alert) => (
          <AlertRow key={alert.id} alert={alert} />
        ))}
      </div>
    </section>
  );
}

function MarkCell({ asset }: { asset: PortfolioAsset }) {
  if (!asset.hasMark) {
    return (
      <span className="text-fg-muted">
        {usd(asset.nav)}
        <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
          est
        </span>
      </span>
    );
  }
  return (
    <span className="text-fg-primary">
      {usd(asset.nav)}
      {asset.markAgeDays != null ? (
        <span
          className={`ml-1 font-mono text-[9px] uppercase tracking-wider ${
            asset.isStale ? "text-status-warning" : "text-fg-muted"
          }`}
        >
          {asset.markAgeDays}d
        </span>
      ) : null}
    </span>
  );
}

function AssetsTable({ assets }: { assets: PortfolioAsset[] }) {
  return (
    <section>
      <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
        Held assets
      </h2>
      <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              <th className="px-4 py-3 font-normal">Asset</th>
              <th className="px-4 py-3 text-right font-normal">Cost</th>
              <th className="px-4 py-3 text-right font-normal">Mark</th>
              <th className="px-4 py-3 text-right font-normal">MOIC</th>
              <th className="px-4 py-3 text-right font-normal">Conc.</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr
                key={asset.id}
                className="border-b border-line/60 last:border-b-0"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-fg-primary">{asset.name}</div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {asset.assetType.replace(/_/g, " ")}
                    {asset.fundName ? ` · ${asset.fundName}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-fg-secondary">
                  {usd(asset.cost)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <MarkCell asset={asset} />
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${gainClass(
                    asset.unrealizedGain,
                  )}`}
                >
                  {moicLabel(asset.moic)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-fg-secondary">
                  {pct(asset.concentrationPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-1 p-8 text-center">
      <p className="text-sm font-medium text-fg-primary">
        No held assets to monitor yet.
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
        Once you log acquired assets and post valuation marks, this screen rolls
        them up into one NAV, cost, and MOIC view — with alerts for stale marks
        and underperformers.
      </p>
    </div>
  );
}

export function PortfolioMonitor({ data }: { data: PortfolioMonitorData }) {
  if (!data.hasData) return <EmptyState />;

  return (
    <div className="flex flex-col gap-8">
      <TotalsStrip data={data} />
      <AlertsList alerts={data.alerts} />
      <AssetsTable assets={data.assets} />
    </div>
  );
}
