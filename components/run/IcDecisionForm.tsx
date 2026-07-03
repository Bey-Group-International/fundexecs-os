"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordIcDecision } from "@/app/(app)/deal/[id]/actions";
import type { IcDecisionKind } from "@/lib/supabase/database.types";

const fieldClass =
  "rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";

const DECISION_META: Record<IcDecisionKind, { label: string; tone: string }> = {
  go: { label: "Go", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  conditional: { label: "Conditional", tone: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  hold: { label: "Hold", tone: "border-status-info/40 bg-status-info/10 text-status-info" },
  no_go: { label: "No-Go", tone: "border-status-danger/40 bg-status-danger/10 text-status-danger" },
};

// Run › War room: records an IC decision and (for go/no_go) advances the deal
// stage. A client wrapper around the recordIcDecision server action so a
// failed vote surfaces to the operator instead of the buttons silently doing
// nothing — same shape as the vote itself.
export function IcDecisionForm({ dealId }: { dealId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      action={(formData: FormData) => {
        setError(null);
        start(async () => {
          const result = await recordIcDecision(formData);
          if (!result.ok) {
            setError(result.error ?? "Could not record the decision.");
            return;
          }
          router.refresh();
        });
      }}
      className="flex flex-col gap-2 print:hidden"
    >
      <input type="hidden" name="deal_id" value={dealId} />
      <textarea
        name="rationale"
        rows={2}
        placeholder="Rationale for the record…"
        className={`${fieldClass} resize-none`}
      />
      <div className="flex flex-wrap gap-2">
        {(["go", "conditional", "hold", "no_go"] as IcDecisionKind[]).map((k) => (
          <button
            key={k}
            name="decision"
            value={k}
            disabled={pending}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${DECISION_META[k].tone}`}
          >
            {DECISION_META[k].label}
          </button>
        ))}
      </div>
      {error ? <p className="text-xs text-status-danger">{error}</p> : null}
    </form>
  );
}
