"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Task, Approval } from "@/lib/supabase/database.types";

export interface WorkflowBundle {
  workflow: Task;
  steps: Task[];
  approval: Approval | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  in_progress: "Active",
  awaiting_approval: "Awaiting approval",
  blocked: "Blocked",
  completed: "Done",
  failed: "Failed",
  cancelled: "Declined",
};

function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "text-status-success";
    case "in_progress":
    case "awaiting_approval":
      return "text-gold-400";
    case "failed":
    case "cancelled":
      return "text-status-danger";
    default:
      return "text-fg-muted";
  }
}

export default function Copilot({
  orgId,
  live,
  bundles,
}: {
  orgId: string;
  live: boolean;
  bundles: WorkflowBundle[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live workspace: any task_event for this org refreshes server data
  // (debounced so a burst of step events coalesces into one refresh).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`org-${orgId}-copilot`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_events", filter: `organization_id=eq.${orgId}` },
        () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => router.refresh(), 400);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = prompt.trim();
    if (!body || busy) return;
    setBusy(true);
    setPrompt("");
    await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }).catch(() => {});
    setBusy(false);
    startTransition(() => router.refresh());
  }

  async function decide(approvalId: string, decision: "approved" | "rejected" | "regenerate") {
    setBusy(true);
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, decision }),
    }).catch(() => {});
    setBusy(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            Agent Copilot
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${live ? "bg-status-success" : "bg-fg-muted"}`}
            />
            {live ? "Copilot ready" : "Fallback mode (no API key)"}
          </span>
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg-primary">
          What should we run?
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Describe the work. The Associate drafts a plan, delegates to agents,
          and asks before it automates.
        </p>
      </header>

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Build the LBO model and test debt capacity…"
          className="flex-1 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
        />
        <button
          disabled={busy || isPending}
          className="rounded-lg bg-gold-400 px-5 py-3 text-sm font-semibold text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
        >
          {busy ? "Planning…" : "Run"}
        </button>
      </form>

      <div className="mt-8 flex flex-col gap-5">
        {bundles.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No workflows yet. Enter a prompt to begin.
          </p>
        ) : null}

        {bundles.map(({ workflow, steps, approval }) => (
          <article
            key={workflow.id}
            className="rounded-xl border border-line bg-surface-1 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-medium text-fg-primary">
                  {workflow.title}
                </h2>
                <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                  {workflow.hub} · {STATUS_LABEL[workflow.status] ?? workflow.status}
                </p>
              </div>
              <div className="h-1 w-24 overflow-hidden rounded bg-surface-3">
                <div
                  className="h-full rounded bg-gold-400 transition-all"
                  style={{ width: `${Math.round(workflow.progress * 100)}%` }}
                />
              </div>
            </div>

            <ol className="mt-4 flex flex-col gap-2.5">
              {steps.map((step) => {
                const agent = AGENT_BY_KEY[step.assigned_agent];
                const output =
                  step.result && typeof step.result === "object"
                    ? (step.result as { output?: string }).output
                    : undefined;
                return (
                  <li
                    key={step.id}
                    className="rounded-lg border border-line/60 bg-surface-2 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${step.status === "in_progress" ? "animate-pulse" : ""}`}
                        style={{ backgroundColor: agent?.color }}
                      />
                      <span className="text-sm font-medium text-fg-primary">
                        {step.title}
                      </span>
                      <span
                        className={`ml-auto font-mono text-[10px] uppercase tracking-wider ${statusTone(step.status)}`}
                      >
                        {STATUS_LABEL[step.status] ?? step.status}
                      </span>
                    </div>
                    <p className="mt-1 pl-4 text-xs text-fg-secondary">
                      <span className="text-fg-muted">{agent?.name}</span> ·{" "}
                      {step.description}
                    </p>
                    {output ? (
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-surface-0 p-3 font-sans text-xs leading-relaxed text-fg-secondary">
                        {output}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {approval && approval.decision === "pending" ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <span className="text-xs text-fg-secondary">{approval.summary}</span>
                <div className="ml-auto flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => decide(approval.id, "approved")}
                    className="rounded-md bg-gold-400 px-3 py-1.5 text-xs font-semibold text-surface-0 hover:bg-gold-300 disabled:opacity-50"
                  >
                    Approve &amp; automate
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => decide(approval.id, "regenerate")}
                    className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-fg-secondary hover:bg-surface-3 disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => decide(approval.id, "rejected")}
                    className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-status-danger hover:bg-surface-3 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
