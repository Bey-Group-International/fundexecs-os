import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { toPercent } from "@/lib/run-conviction";
import { addDiligenceItem, updateDiligenceItem, addUnderwriting } from "@/app/(app)/deal/[id]/actions";
import type { Deal, DiligenceItem, Underwriting, RiskSeverity } from "@/lib/supabase/database.types";

// Deals you can still run evaluation work against — everything that hasn't been
// passed on or died. Ordered newest-first for the picker.
async function activeDeals(orgId: string): Promise<Deal[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("deals")
    .select("*")
    .eq("organization_id", orgId)
    .not("stage", "in", "(passed,dead)")
    .order("created_at", { ascending: false });
  return (data ?? []) as Deal[];
}

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const SEVERITY_OPTS: RiskSeverity[] = ["low", "medium", "high", "critical"];
const DILIGENCE_STATUSES = ["open", "in_review", "cleared", "flagged", "waived"];

const SEV_DOT: Record<RiskSeverity, string> = {
  low: "bg-fg-muted",
  medium: "bg-gold-400",
  high: "bg-status-danger/80",
  critical: "bg-status-danger",
};

function DealPicker({ deals }: { deals: Deal[] }) {
  return (
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
  );
}

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

// --- Run › Diligence: org-wide checklist, now actionable -------------------
export async function RunDiligenceModule({ orgId }: { orgId: string }) {
  const supabase = createServerClient();
  const [deals, itemsRes] = await Promise.all([
    activeDeals(orgId),
    supabase
      .from("diligence_items")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const items = (itemsRes.data ?? []) as DiligenceItem[];
  const nameById = new Map(deals.map((d) => [d.id, d.name]));

  return (
    <div>
      <ModuleHeader title="Diligence" blurb="Open questions and findings that gate conviction — add and clear them right here." />
      {deals.length === 0 ? (
        <NoDeals what="diligence" />
      ) : (
        <>
          <form
            action={addDiligenceItem}
            className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-1 p-3"
          >
            <DealPicker deals={deals} />
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
          </form>

          {items.length === 0 ? (
            <p className="text-sm text-fg-muted">No diligence items yet — add the first one above.</p>
          ) : (
            <div className="divide-y divide-line/50 overflow-hidden rounded-xl border border-line">
              {items.map((i) => {
                const resolved = i.status === "cleared" || i.status === "waived";
                return (
                  <div key={i.id} className={`flex items-center gap-2.5 px-4 py-2.5 ${resolved ? "opacity-60" : "bg-surface-1"}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${i.risk_severity ? SEV_DOT[i.risk_severity] : "bg-line"}`} aria-hidden />
                    <Link href={`/deal/${i.deal_id}`} className="min-w-0 flex-1 truncate text-sm text-fg-primary hover:text-gold-300">
                      {i.title}
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        {nameById.get(i.deal_id) ?? "—"} · {i.category}
                      </span>
                    </Link>
                    <form action={updateDiligenceItem} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="deal_id" value={i.deal_id} />
                      <select
                        name="status"
                        defaultValue={i.status}
                        className="rounded-md border border-line bg-surface-0 px-1.5 py-1 text-[11px] text-fg-secondary focus:border-gold-500/60 focus:outline-none"
                        aria-label="Status"
                      >
                        {DILIGENCE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                      <button className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary transition hover:border-gold-500/50 hover:text-gold-300">
                        Save
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Run › Underwriting: org-wide cases, now actionable --------------------
export async function RunUnderwritingModule({ orgId }: { orgId: string }) {
  const supabase = createServerClient();
  const [deals, uwRes] = await Promise.all([
    activeDeals(orgId),
    supabase
      .from("underwritings")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const cases = (uwRes.data ?? []) as Underwriting[];
  const nameById = new Map(deals.map((d) => [d.id, d.name]));

  return (
    <div>
      <ModuleHeader title="Underwriting" blurb="Base, bull, and bear cases behind every investment decision — add one for any live deal." />
      {deals.length === 0 ? (
        <NoDeals what="underwrite" />
      ) : (
        <>
          <form
            action={addUnderwriting}
            className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-1 p-3"
          >
            <DealPicker deals={deals} />
            <select name="scenario" className={fieldClass} defaultValue="base" aria-label="Scenario">
              <option value="base">Base</option>
              <option value="upside">Upside</option>
              <option value="downside">Downside</option>
              <option value="stress">Stress</option>
            </select>
            <input name="name" placeholder="Label" className={`${fieldClass} w-28`} />
            <input name="projected_irr" placeholder="IRR %" className={`${fieldClass} w-20`} inputMode="decimal" />
            <input name="projected_moic" placeholder="MOIC" className={`${fieldClass} w-20`} inputMode="decimal" />
            <button className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
              Add case
            </button>
          </form>

          {cases.length === 0 ? (
            <p className="text-sm text-fg-muted">No underwriting models yet — add the first case above.</p>
          ) : (
            <div className="divide-y divide-line/50 overflow-hidden rounded-xl border border-line">
              {cases.map((u) => {
                const irr = toPercent(u.projected_irr);
                return (
                  <Link
                    key={u.id}
                    href={`/deal/${u.deal_id}`}
                    className="flex items-center gap-3 bg-surface-1 px-4 py-2.5 transition hover:bg-surface-2"
                  >
                    <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wider text-gold-400">
                      {u.scenario.replace("_", " ")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                      {nameById.get(u.deal_id) ?? "—"}
                      <span className="ml-2 text-fg-muted">{u.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-sm text-fg-secondary">
                      {irr != null ? `${irr}% IRR` : "—"}
                      {u.projected_moic != null ? ` · ${u.projected_moic}x` : ""}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
