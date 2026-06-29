"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { engineOfWorkflow, type GridWorkflow } from "@/lib/execution-grid";
import { RerouteControl } from "@/components/grid/RerouteControl";
import type { ReviewItem, ReviewReason } from "@/lib/routing-review";
import { deleteWorkflow, clearWorkflows } from "@/app/(app)/dashboard/actions";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  in_progress: "Active",
  awaiting_approval: "Awaiting",
  blocked: "Blocked",
  completed: "Done",
  failed: "Failed",
  cancelled: "Declined",
};

// How each review reason reads in the queue.
const REASON_LABEL: Record<ReviewReason, string> = {
  low_confidence: "~ low-confidence",
  escalated: "↑ escalated",
  both: "~ low-confidence · ↑ escalated",
};

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "bg-status-success"
      : status === "in_progress"
        ? "bg-gold-400"
        : status === "awaiting_approval"
          ? "bg-gold-300"
          : status === "failed"
            ? "bg-status-danger"
            : "bg-fg-muted";
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

function DeleteReviewItemBtn({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this workflow permanently?")) return;
        start(async () => {
          await deleteWorkflow(id);
          router.refresh();
        });
      }}
      className="shrink-0 rounded-md border border-status-danger/40 px-1.5 py-0.5 font-mono text-[10px] text-status-danger transition hover:bg-status-danger/10 disabled:opacity-40"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}

function ClearReviewQueueBtn({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (count === 0) return null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Clear all workflows from the review queue? This cannot be undone.")) return;
        start(async () => {
          await clearWorkflows();
          router.refresh();
        });
      }}
      className="rounded-md border border-status-danger/40 px-2 py-0.5 font-mono text-[10px] text-status-danger transition hover:bg-status-danger/10 disabled:opacity-40"
    >
      {pending ? "…" : "Clear all"}
    </button>
  );
}

// The Routing Review queue: workflows whose route a human should confirm or
// fix — low-confidence (hub-default) routes and escalated workflows — each with
// an inline re-route control. Presentational; the page computes the items.
export function ReviewQueue({ items }: { items: ReviewItem<GridWorkflow>[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold-400">FundExecs OS</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-primary">Routing Review</h1>
          <ClearReviewQueueBtn count={items.length} />
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Workflows that need a human to confirm or fix their route — low-confidence routes and escalated work.
          {" "}
          <span className="font-mono text-fg-muted">{items.length} to review</span>
        </p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-line/80 bg-surface-1/70 p-6 text-sm text-fg-muted shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
          Nothing to review — every workflow is routed with confidence and none are escalated.
        </section>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(({ workflow: wf, reason }) => {
            const engine = engineOfWorkflow(wf);
            const inner = (
              <span className="flex items-center gap-2">
                <StatusDot status={wf.status} />
                <span className="min-w-0 flex-1 truncate text-fg-secondary group-hover:text-fg-primary">
                  {wf.title}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {STATUS_LABEL[wf.status] ?? wf.status}
                </span>
              </span>
            );
            return (
              <section
                key={wf.id}
                className="flex flex-col gap-2 rounded-2xl border border-line/80 bg-surface-1/70 p-4 shadow-[0_1px_2px_rgb(0_0_0/0.2)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-wider text-gold-300">
                    {engine}
                  </span>
                  <span className="shrink-0 rounded-full border border-line/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    {REASON_LABEL[reason]}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {wf.session_id ? (
                    <Link
                      href={`/session/${wf.session_id}`}
                      className="group min-w-0 flex-1 rounded-lg border border-line/50 bg-surface-0/40 px-2.5 py-1.5 text-xs transition hover:border-gold-500/40"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1 rounded-lg border border-line/50 bg-surface-0/40 px-2.5 py-1.5 text-xs">
                      {inner}
                    </div>
                  )}
                  <RerouteControl workflowId={wf.id} currentEngine={engine} />
                  <DeleteReviewItemBtn id={wf.id} />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
