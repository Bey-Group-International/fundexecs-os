import type { Deal } from "@/lib/supabase/database.types";

function money(value: number | null): string {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function DealPipelineTable({ deals }: { deals: Deal[] }) {
  return (
    <section className="fx-card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">
          Deal pipeline
        </h2>
      </div>
      {deals.length === 0 ? (
        <p className="p-4 text-sm text-fg-muted">
          No deals yet. Add a target from the quick action panel or open the Source hub.
        </p>
      ) : (
        <>
        <div className="divide-y divide-line/60 sm:hidden">
          {deals.map((deal) => (
            <article key={deal.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg-primary">{deal.name}</p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    {[deal.asset_class, deal.geography].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-gold-500/35 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-gold-300">
                  {deal.stage.replace("_", " ")}
                </span>
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                Target amount <span className="text-fg-secondary">{money(deal.target_amount)}</span>
              </p>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-0/70 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Target</th>
                <th scope="col" className="px-4 py-2 font-medium">Stage</th>
                <th scope="col" className="px-4 py-2 font-medium">Market</th>
                <th scope="col" className="px-4 py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {deals.map((deal) => (
                <tr key={deal.id}>
                  <td className="px-4 py-3 text-fg-primary">{deal.name}</td>
                  <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-gold-300">
                    {deal.stage.replace("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-fg-secondary">
                    {[deal.asset_class, deal.geography].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-fg-secondary">{money(deal.target_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}
