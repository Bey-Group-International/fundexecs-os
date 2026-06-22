"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { rerouteWorkflow } from "@/app/(app)/grid/actions";
import { TARGET_ENGINES, type TargetEngine } from "@/lib/intelligence";

// Operator override: pick a different engine to re-route a workflow the
// Intelligence Layer mis-classified. The correction persists and is logged for
// learning (see app/(app)/grid/actions.ts).
export function RerouteControl({
  workflowId,
  currentEngine,
}: {
  workflowId: string;
  currentEngine: TargetEngine;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Re-route this workflow to a different engine"
      title="Re-route to a different engine"
      disabled={pending}
      value={currentEngine}
      onChange={(e) => {
        const to = e.target.value;
        if (to === currentEngine) return;
        start(async () => {
          await rerouteWorkflow(workflowId, to);
          router.refresh();
        });
      }}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0 rounded-md border border-line/60 bg-surface-1/70 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted outline-none transition hover:border-gold-500/40 hover:text-fg-secondary focus:border-gold-500/60 disabled:opacity-50"
    >
      {TARGET_ENGINES.map((eng) => (
        <option key={eng} value={eng}>
          {eng}
        </option>
      ))}
    </select>
  );
}
