"use client";

// One-click DD checklist template applicator. Pick a deal + a category (or all
// categories) and apply the standard private-markets checklist; existing titles
// on the deal are skipped server-side so re-applying is idempotent.
import type { Deal } from "@/lib/supabase/database.types";
import { DILIGENCE_CATEGORIES } from "@/lib/diligence-templates";
import { applyDiligenceTemplate } from "@/components/run/diligence-actions";

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";

export function DiligenceTemplatePicker({ deals }: { deals: Deal[] }) {
  return (
    <form
      action={applyDiligenceTemplate}
      className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-1 p-3"
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Apply checklist</span>
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
      <select name="category" className={fieldClass} defaultValue="all" aria-label="Template category">
        <option value="all">all categories</option>
        {DILIGENCE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
        Apply template
      </button>
    </form>
  );
}
