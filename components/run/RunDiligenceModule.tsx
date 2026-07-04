import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { addDiligenceItem } from "@/app/(app)/deal/[id]/actions";
import { ActionForm } from "@/components/shared/ActionForm";
import type { Deal, DiligenceItem, RiskSeverity } from "@/lib/supabase/database.types";
import {
  coverageByCategory,
  groupByDeal,
  openCount,
  overdueCount,
} from "@/lib/diligence-templates";
import { DiligenceTemplatePicker } from "@/components/run/DiligenceTemplatePicker";
import { DiligenceDealGroup } from "@/components/run/DiligenceDealGroup";

// Deals you can still run evaluation work against — everything that hasn't been
// passed on or died. Ordered newest-first for the picker.
async function activeDeals(orgId: string): Promise<Deal[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("deals")
    .select("*")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .not("stage", "in", "(passed,dead)")
    .order("created_at", { ascending: false });
  return (data ?? []) as Deal[];
}

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const SEVERITY_OPTS: RiskSeverity[] = ["low", "medium", "high", "critical"];
const labelClass = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

// Shared empty state when there's no deal to attach work to yet.
function NoDeals({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
      <p className="max-w-sm text-sm text-fg-secondary">
        No deals to {what} yet. Move a deal into evaluation from the{" "}
        <Link href="/source/deal_pipeline" className="text-gold-400 hover:underline">
          deal pipeline
        </Link>{" "}
        first.
      </p>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 px-4 py-3">
      <div className={labelClass}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${danger && value > 0 ? "text-status-danger" : "text-fg-primary"}`}>
        {value}
      </div>
    </div>
  );
}

// --- Run › Diligence: org-wide checklist, now actionable -------------------
export async function RunDiligenceModule({ orgId }: { orgId: string }) {
  const supabase = await createServerClient();
  const [deals, itemsRes] = await Promise.all([
    activeDeals(orgId),
    supabase
      .from("diligence_items")
      .select("*")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const items = (itemsRes.data ?? []) as DiligenceItem[];
  const nameById = new Map(deals.map((d) => [d.id, d.name]));
  const today = new Date().toISOString().slice(0, 10);

  const coverage = coverageByCategory(items);
  const groups = groupByDeal(items);
  const open = openCount(items);
  const overdue = overdueCount(items, today);

  return (
    <div>
      <ModuleHeader title="Diligence" blurb="Open questions and findings that gate conviction — add and clear them right here." />
      {deals.length === 0 ? (
        <NoDeals what="diligence" />
      ) : (
        <>
          {/* Portfolio-wide rollup */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Stat label="Open items" value={open} />
            <Stat label="Overdue" value={overdue} danger />
            <Stat label="Total tracked" value={items.length} />
          </div>

          {/* One-click checklist templates */}
          <DiligenceTemplatePicker deals={deals} />

          {/* Manual add */}
          <ActionForm
            action={addDiligenceItem}
            className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-1 p-3"
          >
            <select name="deal_id" className={fieldClass} required defaultValue="" aria-label="Deal">
              <option value="" disabled>
                Deal…
              </option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <input name="title" placeholder="New diligence item…" className={`${fieldClass} min-w-0 flex-1`} required />
            <input name="category" placeholder="Category" className={`${fieldClass} w-28`} />
            <select name="risk_severity" className={fieldClass} defaultValue="" aria-label="Severity">
              <option value="">severity…</option>
              {SEVERITY_OPTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
              Add
            </button>
          </ActionForm>

          {items.length === 0 ? (
            <p className="text-sm text-fg-muted">No diligence items yet — add the first one above or apply a template.</p>
          ) : (
            <>
              {/* Category coverage */}
              <div className="mb-5">
                <div className={`mb-2 ${labelClass}`}>Coverage by category</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {coverage.map((c) => (
                    <div key={c.category} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs capitalize text-fg-secondary">{c.category}</span>
                        <span className={labelClass}>
                          {c.resolved}/{c.total}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-0">
                        <div className="h-full bg-emerald-500" style={{ width: `${Math.round(c.ratio * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-deal groups with bulk actions */}
              <div className="space-y-4">
                {groups.map((g) => (
                  <DiligenceDealGroup
                    key={g.dealId}
                    dealId={g.dealId}
                    dealName={nameById.get(g.dealId) ?? "Unknown deal"}
                    items={g.items}
                    total={g.total}
                    resolved={g.resolved}
                    progress={g.progress}
                    today={today}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
