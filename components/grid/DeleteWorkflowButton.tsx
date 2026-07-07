"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteWorkflow } from "@/app/(app)/grid/actions";

// Small red pill button to permanently delete a single routed workflow from an
// engine pane. Rows are wrapped in a Link, so we stop propagation to avoid
// navigating on click, and confirm first since the delete is permanent.
export function DeleteWorkflowButton({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending || done) return;
    const ok = window.confirm(
      "Delete this workflow? This permanently removes it and everything it produced. This cannot be undone.",
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteWorkflow(workflowId);
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
      aria-label="Delete workflow"
      title="Delete"
      className="shrink-0 rounded-full border border-status-danger/40 bg-status-danger/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-danger transition hover:bg-status-danger/20 disabled:opacity-60"
    >
      {done ? "Deleted" : pending ? "Deleting…" : "Delete"}
    </button>
  );
}
