"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { escalateStuckWorkflow } from "@/app/(app)/grid/actions";

// Small amber pill button (mirrors the STUCK marker styling) that escalates a
// stuck workflow into a tracked team task. Optimistic: shows pending/done state
// and refreshes the drill-down so the row reflects any server-side change.
export function EscalateButton({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick(e: React.MouseEvent) {
    // Rows are wrapped in a Link — don't navigate when escalating.
    e.preventDefault();
    e.stopPropagation();
    if (pending || done) return;
    startTransition(async () => {
      const res = await escalateStuckWorkflow(workflowId);
      if (res.ok) {
        setDone(true);
        router.refresh();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || done}
      className="shrink-0 rounded-full border border-status-danger/40 bg-status-danger/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-danger transition hover:bg-status-danger/20 disabled:opacity-60"
    >
      {done ? "Escalated" : pending ? "Escalating…" : "Escalate"}
    </button>
  );
}
