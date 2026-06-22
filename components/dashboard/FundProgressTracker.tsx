import type { Fund } from "@/lib/supabase/database.types";

function money(value: number | null | undefined): string {
  if (!value) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function FundProgressTracker({ funds }: { funds: Fund[] }) {
  return (
    <section className="fx-card p-4">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-fg-muted">
        Fund progress
      </h2>
      {funds.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-0/60 p-4 text-sm text-fg-muted">
          Create the first fund workspace to track target raise, commitments, calls, and reporting readiness.
        </p>
      ) : (
        <div className="space-y-3">
          {funds.map((fund) => {
            const target = fund.target_size ?? 0;
            const progress = target > 0 ? Math.min(100, Math.round((fund.committed_capital / target) * 100)) : 0;
            return (
              <div key={fund.id} className="rounded-xl border border-line bg-surface-0/55 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-fg-primary">{fund.name}</p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {fund.fund_type.replace("_", " ")} · {fund.vintage_year ?? "Vintage TBD"}
                    </p>
                  </div>
                  <span className="font-display text-xl font-semibold text-fg-primary">
                    {progress}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full rounded-full bg-gold-500" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-xs text-fg-muted">
                  {money(fund.committed_capital)} committed of {money(fund.target_size)} target
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
