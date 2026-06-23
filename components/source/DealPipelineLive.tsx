// components/source/DealPipelineLive.tsx
// Async server component — renders the active deal pipeline for this org.
// Best-effort: any auth/DB failure degrades to an empty state, never a crash.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

const STAGE_STYLES: Record<string, string> = {
  sourced: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  screening: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  diligence: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  under_contract: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  closed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  passed: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
};

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

async function loadDeals() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return [];
    const supabase = createServerClient();
    const { data } = await supabase
      .from("deals")
      .select(
        "id, name, stage, asset_class, geography, target_amount, thesis_fit, expected_close, notes",
      )
      .eq("organization_id", auth.ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function DealPipelineLive() {
  const deals = await loadDeals();

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Deal Pipeline
        </p>
        <span className="font-mono text-[11px] text-fg-muted">
          {deals.length} deal{deals.length !== 1 ? "s" : ""}
        </span>
      </div>

      {deals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">No deals yet.</p>
          <p className="mt-1 text-xs text-fg-muted/60">
            Use Earn to source deal targets or add them manually.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-subtle">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Deal
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Stage
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Asset Class
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Target
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Fit
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Close
                </th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d, i) => (
                <tr
                  key={d.id}
                  className={
                    i < deals.length - 1 ? "border-b border-line" : ""
                  }
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-fg">{d.name}</p>
                    {d.geography && (
                      <p className="mt-0.5 text-xs text-fg-muted">
                        {d.geography}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                        STAGE_STYLES[d.stage ?? ""] ??
                        "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {(d.stage ?? "unknown").replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {d.asset_class ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg">
                    {formatCurrency(d.target_amount)}
                  </td>
                  <td className="px-4 py-3">
                    {d.thesis_fit != null ? (
                      <span className="font-mono text-xs font-semibold text-accent">
                        {Number(d.thesis_fit).toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">
                    {d.expected_close ?? "—"}
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
