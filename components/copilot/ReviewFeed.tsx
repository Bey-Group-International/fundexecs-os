"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { approveRun, dismissRun, getRecentRuns, type RunSummary } from "@/components/copilot/actions";
import type { TaskStatus } from "@/lib/supabase/database.types";

// Map a workflow's status to a tone + label for its pill. Statuses outside this
// map (pending/blocked/cancelled) fall through to a neutral default.
const STATUS_PILL: Partial<Record<TaskStatus, { label: string; cls: string }>> = {
  awaiting_approval: { label: "needs you", cls: "border-neural-400/45 text-neural-300" },
  in_progress: { label: "running", cls: "border-status-info/40 text-status-info" },
  completed: { label: "done", cls: "border-emerald-400/40 text-emerald-300" },
  failed: { label: "failed", cls: "border-status-danger/40 text-status-danger" },
};

function StatusPill({ status }: { status: TaskStatus }) {
  const pill = STATUS_PILL[status] ?? { label: status.replace(/_/g, " "), cls: "border-line text-fg-muted" };
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${pill.cls}`}
    >
      {pill.label}
    </span>
  );
}

/**
 * The dock's "Recent runs" section: surfaces the copilot's most recent
 * workflows so the operator can review, approve, or dismiss results at a glance.
 * Self-fetches when `open` flips true and re-fetches whenever a run is acted on.
 */
export function ReviewFeed({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(() => {
    return getRecentRuns().then((r) => setRuns(r));
  }, []);

  // Pull the feed each time the dock opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    getRecentRuns().then((r) => {
      if (active) setRuns(r);
    });
    return () => {
      active = false;
    };
  }, [open]);

  if (!runs || runs.length === 0) return null;

  // Submit an approve/dismiss action, then re-fetch the feed.
  function act(action: (fd: FormData) => Promise<void>, approvalId: string) {
    const fd = new FormData();
    fd.set("approval_id", approvalId);
    start(async () => {
      await action(fd);
      await refresh();
    });
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-neural-300">Recent runs</p>
      <div className="flex flex-col gap-2">
        {runs.map((run, i) => (
          <div key={run.sessionId ?? `run-${i}`} className="rounded-xl border border-neural-400/15 bg-black/55 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-sm font-medium text-fg-primary">{run.title}</span>
              <StatusPill status={run.status} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {run.sessionId ? (
                <Link
                  href={`/session/${run.sessionId}`}
                  onClick={onClose}
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-neural-300"
                >
                  Open →
                </Link>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">No session</span>
              )}
              {run.status === "awaiting_approval" && run.approvalId ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => act(dismissRun, run.approvalId!)}
                    disabled={pending}
                    className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-muted transition hover:border-status-danger/40 hover:text-status-danger disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => act(approveRun, run.approvalId!)}
                    disabled={pending}
                    className="rounded-md bg-neural-400 px-2.5 py-1 text-[11px] font-medium text-black transition hover:bg-neural-300 disabled:opacity-50"
                  >
                    Approve
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
