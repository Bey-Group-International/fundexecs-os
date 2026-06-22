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
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-0/70 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
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
                  <td className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-gold-300">
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
      )}
    </section>
  );
}
