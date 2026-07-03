"use client";

// Client wrapper for one deal's diligence list: holds the per-item selection
// set and drives the bulk clear/flag action. Each row also exposes inline
// finding capture and owner/due assignment via plain server-action forms.
import { useState } from "react";
import Link from "next/link";
import type { DiligenceItem, RiskSeverity } from "@/lib/supabase/database.types";
import { isOverdue } from "@/lib/diligence-templates";
import {
  bulkUpdateDiligence,
  updateDiligenceFinding,
  setDiligenceOwnerDue,
} from "@/components/run/diligence-actions";
import { updateDiligenceItem } from "@/app/(app)/deal/[id]/actions";
import { RecordBulkLifecycleActions, RecordLifecycleActions } from "@/components/RecordLifecycleActions";
import { ActionForm } from "@/components/shared/ActionForm";

const SEV_DOT: Record<RiskSeverity, string> = {
  low: "bg-fg-muted",
  medium: "bg-gold-400",
  high: "bg-status-danger/80",
  critical: "bg-status-danger",
};
const DILIGENCE_STATUSES = ["open", "in_review", "cleared", "flagged", "waived"];
const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const labelClass = "font-mono text-[10px] uppercase tracking-wider text-fg-muted";

export function DiligenceDealGroup({
  dealId,
  dealName,
  items,
  total,
  resolved,
  progress,
  today,
}: {
  dealId: string;
  dealName: string;
  items: DiligenceItem[];
  total: number;
  resolved: number;
  progress: number;
  today: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedIds = [...selected];

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2.5">
        <Link href={`/deal/${dealId}`} className="text-sm font-medium text-fg-primary hover:text-gold-300">
          {dealName}
        </Link>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-0">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className={labelClass}>
            {resolved}/{total} cleared
          </span>
        </div>
        <div className="ml-auto">
          {selectedIds.length > 0 && (
            <ActionForm action={bulkUpdateDiligence} className="flex items-center gap-1.5">
              {selectedIds.map((id) => (
                <input key={id} type="hidden" name="ids" value={id} />
              ))}
              <span className={labelClass}>{selectedIds.length} selected</span>
              <button
                name="status"
                value="cleared"
                className="rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-400 transition hover:bg-emerald-500/10"
              >
                Clear
              </button>
              <button
                name="status"
                value="flagged"
                className="rounded-md border border-status-danger/40 px-2 py-1 text-[11px] text-status-danger transition hover:bg-status-danger/10"
              >
                Flag
              </button>
              <RecordBulkLifecycleActions
                hub="run"
                module="diligence"
                table="diligence_items"
                ids={selectedIds}
                onComplete={() => setSelected(new Set())}
              />
            </ActionForm>
          )}
        </div>
      </div>

      <div className="divide-y divide-line/50">
        {items.map((i) => {
          const resolvedItem = i.status === "cleared" || i.status === "waived";
          const overdue = isOverdue(i, today);
          return (
            <div key={i.id} className={`px-4 py-2.5 ${resolvedItem ? "opacity-60" : "bg-surface-1"}`}>
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(i.id)}
                  onChange={() => toggle(i.id)}
                  className="h-3.5 w-3.5 shrink-0 accent-gold-400"
                  aria-label={`Select ${i.title}`}
                />
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${i.risk_severity ? SEV_DOT[i.risk_severity] : "bg-line"}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                  {i.title}
                  <span className={`ml-2 ${labelClass}`}>{i.category}</span>
                </span>
                {i.owner && <span className={labelClass}>{i.owner}</span>}
                {i.due_date && (
                  <span className={overdue ? "font-mono text-[10px] uppercase tracking-wider text-status-danger" : labelClass}>
                    {overdue ? "overdue " : "due "}
                    {i.due_date}
                  </span>
                )}
                <ActionForm action={updateDiligenceItem} className="flex items-center gap-1">
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
                </ActionForm>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <ActionForm action={updateDiligenceFinding} className="flex min-w-0 flex-1 items-center gap-1">
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="deal_id" value={i.deal_id} />
                  <input
                    name="finding"
                    defaultValue={i.finding ?? ""}
                    placeholder="Finding…"
                    className={`${fieldClass} min-w-0 flex-1 py-1 text-xs`}
                  />
                  <button className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary transition hover:border-gold-500/50 hover:text-gold-300">
                    Note
                  </button>
                </ActionForm>
                <ActionForm action={setDiligenceOwnerDue} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={i.id} />
                  <input type="hidden" name="deal_id" value={i.deal_id} />
                  <input
                    name="owner"
                    defaultValue={i.owner ?? ""}
                    placeholder="Owner"
                    className={`${fieldClass} w-24 py-1 text-xs`}
                  />
                  <input
                    name="due_date"
                    type="date"
                    defaultValue={i.due_date ?? ""}
                    className={`${fieldClass} py-1 text-xs`}
                    aria-label="Due date"
                  />
                  <button className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary transition hover:border-gold-500/50 hover:text-gold-300">
                    Assign
                  </button>
                </ActionForm>
                <RecordLifecycleActions
                  hub="run"
                  module="diligence"
                  table="diligence_items"
                  id={i.id}
                  deleteClassName=""
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
