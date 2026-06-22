import type { Investor } from "@/lib/supabase/database.types";

function money(value: number | null): string {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function InvestorPipelineTable({ investors }: { investors: Investor[] }) {
  return (
    <section className="fx-card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">
          Investor pipeline
        </h2>
      </div>
      {investors.length === 0 ? (
        <p className="p-4 text-sm text-fg-muted">
          No investors yet. Add the first LP or capital source from the quick action panel.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-0/70 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Investor</th>
                <th scope="col" className="px-4 py-2 font-medium">Stage</th>
                <th scope="col" className="px-4 py-2 font-medium">Contact</th>
                <th scope="col" className="px-4 py-2 font-medium">Check size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {investors.map((investor) => (
                <tr key={investor.id}>
                  <td className="px-4 py-3 text-fg-primary">{investor.name}</td>
                  <td className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-gold-300">
                    {investor.pipeline_stage.replace("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-fg-secondary">
                    {investor.contact_name ?? investor.contact_email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-fg-secondary">
                    {money(investor.typical_check_min)}–{money(investor.typical_check_max)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
