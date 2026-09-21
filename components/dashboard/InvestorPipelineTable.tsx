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
        <>
        <div className="divide-y divide-line/60 sm:hidden">
          {investors.map((investor) => (
            <article key={investor.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg-primary">{investor.name}</p>
                  <p className="mt-1 text-xs text-fg-secondary">
                    {investor.contact_name ?? investor.contact_email ?? "—"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-gold-500/35 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-gold-300">
                  {investor.pipeline_stage.replace("_", " ")}
                </span>
              </div>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                Check size{" "}
                <span className="text-fg-secondary">
                  {money(investor.typical_check_min)}–{money(investor.typical_check_max)}
                </span>
              </p>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-0/70 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
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
                  <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-gold-300">
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
        </>
      )}
    </section>
  );
}
