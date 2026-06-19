"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Task, Approval, Artifact } from "@/lib/supabase/database.types";
import { ArtifactInline, ARTIFACT_LABEL } from "@/components/ArtifactViewer";

export interface WorkflowBundle {
  workflow: Task;
  steps: Task[];
  artifacts: Artifact[];
  approval: Approval | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  in_progress: "Active",
  awaiting_approval: "Awaiting",
  blocked: "Blocked",
  completed: "Done",
  failed: "Failed",
  cancelled: "Declined",
};

function StepNode({ status, color }: { status: string; color?: string }) {
  if (status === "completed") {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-surface-0"
        style={{ backgroundColor: color }}
      >
        ✓
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center">
        <span className="absolute h-5 w-5 animate-pulse rounded-full opacity-40" style={{ backgroundColor: color }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      </span>
    );
  }
  if (status === "cancelled" || status === "failed") {
    return <span className="flex h-5 w-5 items-center justify-center rounded-full border border-status-danger text-[10px] text-status-danger">×</span>;
  }
  return <span className="h-5 w-5 rounded-full border-2 border-line" />;
}

export default function Copilot({
  orgId,
  live,
  bundles,
  sessionId,
}: {
  orgId: string;
  live: boolean;
  bundles: WorkflowBundle[];
  // When set, prompts run inside this session and Earn plans with the session's
  // earlier turns in mind. The composer reads as a reply rather than a launch.
  sessionId?: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest turn in view as the conversation grows — chat behavior.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bundles.length, planning]);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 400);
    };
    const channel = supabase
      .channel(`org-${orgId}-copilot`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_events", filter: `organization_id=eq.${orgId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "artifacts", filter: `organization_id=eq.${orgId}` },
        refresh,
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
    setPlanning(true);
    setPrompt("");
    const res = await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionId ? { body, session_id: sessionId } : { body }),
    }).catch(() => null);
    setBusy(false);
    setPlanning(false);

    // From the launcher (no session yet), the prompt opens a session — follow
    // it in, Claude Code style, so the work continues at /session/<id>. Inside
    // a session we just refresh to surface the new workflow in place.
    if (!sessionId && res?.ok) {
      const data = await res.json().catch(() => null);
      if (data?.session_id) {
        router.push(`/session/${data.session_id}`);
        return;
      }
    }
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

  // Conversation order: oldest turn first, newest nearest the composer.
  const turns = [...bundles].reverse();
  const empty = turns.length === 0 && !planning;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <header className="flex items-center gap-2 pb-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-gold-400">
          Earn · Agent Copilot
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-status-success" : "bg-fg-muted"}`} />
          {live ? "Earn ready" : "Fallback mode"}
        </span>
      </header>

      {/* Transcript — each turn is the operator's prompt and Earn's response. */}
      <div className="flex flex-1 flex-col gap-6 pb-4">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-fg-primary">
              What should we run?
            </h1>
            <p className="mt-2 max-w-md text-sm text-fg-secondary">
              Describe the work. The Associate drafts a plan, delegates to agents,
              and asks before it automates. Follow-ups stay in this conversation.
            </p>
          </div>
        ) : null}

        {turns.map((b) => (
          <div key={b.workflow.id} className="flex flex-col gap-3">
            {/* Operator's prompt */}
            <div className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-surface-2 px-4 py-2.5 text-sm text-fg-primary">
                {b.workflow.description || b.workflow.title}
              </div>
            </div>
            {/* Earn's response */}
            <WorkflowCard
              bundle={b}
              busy={busy}
              decide={decide}
              primary={b.approval?.decision === "pending"}
            />
          </div>
        ))}

        {planning ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold-400" />
            Reading your prompt · drafting a plan…
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {/* Composer — pinned to the bottom of the conversation. */}
      <form
        onSubmit={submit}
        className="sticky bottom-0 flex gap-2 border-t border-line bg-surface-0/90 pb-1 pt-3 backdrop-blur supports-[backdrop-filter]:bg-surface-0/75"
      >
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            sessionId
              ? "Reply to Earn — this stays in the conversation…"
              : "e.g. Build the LBO model and test debt capacity…"
          }
          className="flex-1 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
        />
        <button
          disabled={busy}
          className="rounded-lg bg-gold-400 px-5 py-3 text-sm font-semibold text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
        >
          {planning ? "Planning…" : sessionId ? "Send" : "Run"}
        </button>
      </form>
    </div>
  );
}

function WorkflowSteps({ bundle }: { bundle: WorkflowBundle }) {
  const { steps, artifacts } = bundle;
  const artifactByStep = new Map<string, Artifact>();
  for (const a of artifacts) if (a.step_id) artifactByStep.set(a.step_id, a);
  return (
    <ol className="relative flex flex-col gap-3">
      {steps.map((step, i) => {
        const agent = AGENT_BY_KEY[step.assigned_agent];
        const artifact = artifactByStep.get(step.id);
        // Prefer the durable artifact; fall back to the step's inline result.
        const output =
          artifact?.content ??
          (step.result && typeof step.result === "object"
            ? (step.result as { output?: string }).output
            : undefined);
        return (
          <li key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepNode status={step.status} color={agent?.color} />
              {i < steps.length - 1 ? <span className="mt-1 w-px flex-1 bg-line" /> : null}
            </div>
            <div className="flex-1 pb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-fg-primary">{step.title}</span>
                {artifact ? (
                  <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                    {ARTIFACT_LABEL[artifact.artifact_type]}
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {STATUS_LABEL[step.status] ?? step.status}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-fg-secondary">
                <span className="font-mono uppercase text-fg-muted">{agent?.name}</span> · {step.description}
              </p>
              {output ? (
                <ArtifactInline content={output} artifactType={artifact?.artifact_type} />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function WorkflowCard({
  bundle,
  busy,
  decide,
  primary,
}: {
  bundle: WorkflowBundle;
  busy: boolean;
  decide: (id: string, d: "approved" | "rejected" | "regenerate") => void;
  primary?: boolean;
}) {
  const { workflow, approval } = bundle;
  return (
    <article className={`rounded-xl border bg-surface-1 p-5 ${primary ? "border-gold-500/30" : "border-line"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-medium text-fg-primary">{workflow.title}</h2>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {workflow.hub} · {STATUS_LABEL[workflow.status] ?? workflow.status}
          </p>
        </div>
        <div className="h-1 w-24 overflow-hidden rounded bg-surface-3">
          <div className="h-full rounded bg-gold-400 transition-all" style={{ width: `${Math.round(workflow.progress * 100)}%` }} />
        </div>
      </div>

      <div className="mt-4">
        <WorkflowSteps bundle={bundle} />
      </div>

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
  );
}
