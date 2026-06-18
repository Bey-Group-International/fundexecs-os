"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Task, Approval, Artifact, ArtifactType, AgentKey } from "@/lib/supabase/database.types";

export interface WorkflowBundle {
  workflow: Task;
  steps: Task[];
  artifacts: Artifact[];
  approval: Approval | null;
}

// Short, human labels for the deliverable badge on each step.
const ARTIFACT_LABEL: Record<ArtifactType, string> = {
  ic_memo: "IC Memo",
  model: "Model",
  analysis: "Analysis",
  risk_report: "Risk Report",
  lp_update: "LP Update",
  memo: "Memo",
  summary: "Summary",
  other: "Deliverable",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  in_progress: "Active",
  awaiting_approval: "Awaiting",
  blocked: "Blocked",
  completed: "Done",
  failed: "Failed",
  cancelled: "Declined",
};

// Agent workforce groupings (matches the Command Center).
const GROUPS: { label: string; keys: AgentKey[] }[] = [
  { label: "Research", keys: ["analyst", "diligence"] },
  { label: "Workflow", keys: ["associate", "investor_relations"] },
  { label: "Execution", keys: ["portfolio_ops", "fund_admin"] },
];

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
}: {
  orgId: string;
  live: boolean;
  bundles: WorkflowBundle[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }).catch(() => {});
    setBusy(false);
    setPlanning(false);
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

  // Which agents are currently executing a step (drives the workforce rail).
  const activeAgents = new Set<AgentKey>();
  for (const b of bundles) {
    for (const s of b.steps) if (s.status === "in_progress") activeAgents.add(s.assigned_agent);
  }

  const [activeBundle, ...history] = bundles;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <header className="mb-5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-gold-400">
              Agent Copilot
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-status-success" : "bg-fg-muted"}`} />
              {live ? "Copilot ready" : "Fallback mode"}
            </span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-fg-primary">
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
            disabled={busy}
            className="rounded-lg bg-gold-400 px-5 py-3 text-sm font-semibold text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
          >
            {planning ? "Planning…" : "Run"}
          </button>
        </form>

        {planning ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold-400" />
            Reading your prompt · drafting a plan…
          </div>
        ) : null}

        <div className="mt-7 flex flex-col gap-5">
          {bundles.length === 0 && !planning ? (
            <p className="text-sm text-fg-muted">No workflows yet. Enter a prompt to begin.</p>
          ) : null}

          {activeBundle ? (
            <WorkflowCard bundle={activeBundle} busy={busy} decide={decide} primary />
          ) : null}

          {history.length > 0 ? (
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                Earlier workflows
              </p>
              <div className="flex flex-col gap-2">
                {history.map((b) => (
                  <details key={b.workflow.id} className="rounded-lg border border-line bg-surface-1">
                    <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm text-fg-secondary">
                      <span className="truncate text-fg-primary">{b.workflow.title}</span>
                      <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        {b.workflow.hub} · {STATUS_LABEL[b.workflow.status] ?? b.workflow.status}
                      </span>
                    </summary>
                    <div className="border-t border-line px-4 py-3">
                      <WorkflowSteps bundle={b} />
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* AI Agent Workforce rail */}
      <aside className="lg:border-l lg:border-line lg:pl-5">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          AI Agent Workforce
        </p>
        <div className="flex flex-col gap-4">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-gold-400">
                {group.label}
              </p>
              <div className="flex flex-col gap-1.5">
                {group.keys.map((key) => {
                  const agent = AGENT_BY_KEY[key];
                  const active = activeAgents.has(key);
                  return (
                    <div key={key} className="rounded-lg border border-line bg-surface-1 p-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${active ? "animate-pulse" : "opacity-50"}`}
                          style={{ backgroundColor: agent.color }}
                        />
                        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-primary">
                          {agent.name}
                        </span>
                        <span className="ml-auto font-mono text-[9px] uppercase text-fg-muted">
                          {active ? "active" : "ready"}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-fg-muted">
                        {agent.role}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>
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
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-0 p-3 font-sans text-xs leading-relaxed text-fg-secondary">
                  {output}
                </pre>
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
