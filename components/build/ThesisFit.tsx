import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import type { Investor, InvestmentThesis } from "@/lib/supabase/database.types";
import { scoreThesisFit } from "@/lib/capital-map";

// Server-rendered preview: scores the org's investors against the given thesis
// and summarizes how the LP base fits the mandate. Read-only; tenancy enforced
// by RLS on the server client.
export async function ThesisFit({ thesis }: { thesis: InvestmentThesis | null }) {
  if (!thesis) return null;

  const supabase = await createServerClient();
  const { data } = await supabase.from("investors").select("*").limit(100);
  const investors = (data ?? []) as Investor[];

  if (investors.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-line bg-surface-1 p-4">
        <h3 className="text-sm font-medium text-fg-primary">Thesis fit preview</h3>
        <p className="mt-1 text-xs text-fg-secondary">
          No LPs to score yet.{" "}
          <Link href="/source/lp_pipeline" className="text-gold-300 underline-offset-2 hover:underline">
            Add investors to your pipeline
          </Link>{" "}
          to preview fit.
        </p>
      </div>
    );
  }

  const scored = investors
    .map((inv) => ({ inv, fit: scoreThesisFit(inv, thesis) }))
    .filter((s): s is { inv: Investor; fit: { score: number; reasons: string[] } } => s.fit != null)
    .sort((a, b) => b.fit.score - a.fit.score);

  const strong = scored.filter((s) => s.fit.score >= 60).length;
  const medium = scored.filter((s) => s.fit.score >= 30 && s.fit.score < 60).length;
  const weak = scored.filter((s) => s.fit.score < 30).length;
  const top = scored.slice(0, 3);

  const stat = (label: string, count: number, tone: string) => (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-lg font-semibold tabular-nums ${tone}`}>{count}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</span>
    </div>
  );

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg-primary">Thesis fit preview</h3>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          vs. {scored.length} LP{scored.length === 1 ? "" : "s"} · “{thesis.title}”
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-6">
        {stat("strong (≥60)", strong, "text-status-success")}
        {stat("medium (30–59)", medium, "text-status-warning")}
        {stat("weak (<30)", weak, "text-fg-muted")}
      </div>

      {top.length ? (
        <div className="mt-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Top fits</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {top.map(({ inv, fit }) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-fg-secondary">{inv.name}</span>
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                    fit.score >= 60
                      ? "border-status-success/40 bg-status-success/10 text-status-success"
                      : fit.score >= 30
                        ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
                        : "border-line text-fg-muted"
                  }`}
                >
                  {fit.score}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
