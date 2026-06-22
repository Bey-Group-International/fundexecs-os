"use client";

import { useEffect, useRef, useState } from "react";
import {
  startExecuteSearch,
  runExecuteStep,
  completeExecuteSearch,
  type ExecuteStep,
} from "@/app/(app)/[hub]/[module]/execute-search-actions";
import { AGENTS, AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey } from "@/lib/supabase/database.types";

type StepStatus = "queued" | "running" | "done" | "error";
interface LiveStep extends ExecuteStep {
  status: StepStatus;
  deliverable?: string;
}
type Phase = "idle" | "planning" | "running" | "done";

// The Execute team: Earn (coordinator) + the three Execute-hub agents.
const TEAM = [AGENT_BY_KEY.associate, ...AGENTS.filter((a) => a.hub === "execute")];

const EXAMPLES = [
  "Draft this quarter's LP update",
  "Summarize capital calls due",
  "Portfolio KPI flags this month",
];

// Conversational, agentic Execute-hub surface — describe a post-close operations
// request, Earn briefs the Execute team, each specialist works its step in a live
// timeline, and synthesized deliverables come back for review.
export function ExecuteSearch({
  live,
  initialPrompt,
}: {
  live: boolean;
  initialPrompt?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [activeAgent, setActiveAgent] = useState<AgentKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  const busy = phase === "planning" || phase === "running";

  async function run(p: string) {
    const clean = p.trim();
    if (!clean || busy) return;
    setError(null);
    setPhase("planning");
    setSummary("");
    setSteps([]);
    setActiveAgent("associate");

    try {
      const res = await startExecuteSearch(clean);
      if (!res.ok || !res.workflowId || !res.steps) {
        setError(res.error ?? "Could not start the workflow.");
        setPhase("idle");
        setActiveAgent(null);
        return;
      }
      setSummary(res.summary ?? "");
      setSteps(res.steps.map((s) => ({ ...s, status: "queued" as StepStatus })));
      setPhase("running");

      for (const s of res.steps) {
        setActiveAgent(s.agent);
        setSteps((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: "running" } : x)));
        let r: Awaited<ReturnType<typeof runExecuteStep>>;
        try {
          r = await runExecuteStep({
            workflowId: res.workflowId,
            stepId: s.id,
            agent: s.agent,
            title: s.title,
            instruction: s.instruction,
          });
        } catch {
          r = { ok: false };
        }
        setSteps((prev) =>
          prev.map((x) =>
            x.id === s.id
              ? { ...x, status: r.ok ? "done" : "error", deliverable: r.deliverable }
              : x,
          ),
        );
      }

      setActiveAgent(null);
      await completeExecuteSearch(res.workflowId);
      setPhase("done");
    } catch {
      setError("The workflow did not finish. Please try again.");
      setActiveAgent(null);
      setPhase("idle");
    }
  }

  // Auto-run when arriving with a prefilled query (e.g. from a command center).
  useEffect(() => {
    if (initialPrompt && !ranInitial.current) {
      ranInitial.current = true;
      run(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ AI Ops
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              offline mode
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Describe the post-close operations you need. Earn briefs the Execute team — each specialist
          works its part and returns a deliverable you review before it goes out.
        </p>
      </header>

      {/* The team */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TEAM.map((a) => {
          const on = activeAgent === a.key || (phase === "planning" && a.key === "associate");
          return (
            <span
              key={a.key}
              title={a.role}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                on ? "border-gold-500/50 bg-gold-500/10 text-fg-primary" : "border-line text-fg-muted"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${on ? "animate-pulse" : ""}`}
                style={{ backgroundColor: a.color }}
                aria-hidden
              />
              {a.name}
            </span>
          );
        })}
      </div>

      {/* Prompt */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(prompt);
        }}
        className="rounded-2xl border border-gold-500/25 bg-gradient-to-b from-gold-500/[0.06] to-transparent p-4"
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="e.g. Draft this quarter's LP update"
          className="w-full resize-none rounded-lg border border-line bg-surface-0 px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-gold-500"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={busy}
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted transition hover:bg-surface-2 hover:text-fg-secondary disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="shrink-0 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
          >
            {busy ? "Working…" : "Run"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {/* Earn's brief + the live timeline */}
      {summary ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: AGENT_BY_KEY.associate.color }}
              aria-hidden
            />
            <span className="text-fg-primary">{summary}</span>
          </div>
          <ol className="space-y-2 border-l border-line pl-4">
            {steps.map((s) => (
              <li key={s.id} className="relative">
                <span
                  className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface-0"
                  style={{ backgroundColor: AGENT_BY_KEY[s.agent]?.color ?? "#888" }}
                  aria-hidden
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg-primary">{s.title}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider">
                    {s.status === "queued" ? (
                      <span className="text-fg-muted">queued</span>
                    ) : s.status === "running" ? (
                      <span className="animate-pulse text-gold-300">working…</span>
                    ) : s.status === "error" ? (
                      <span className="text-status-danger">failed</span>
                    ) : (
                      <span className="text-status-success">✓ done</span>
                    )}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-fg-muted">{s.agentName}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* Results — synthesized deliverables */}
      {steps.some((s) => s.status === "done" && s.deliverable) ? (
        <div className="mt-6 space-y-4">
          {steps
            .filter((s) => s.status === "done" && s.deliverable)
            .map((s) => (
              <div key={s.id} className="rounded-2xl border border-line bg-surface-1 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                    {s.title} · {s.agentName}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
                  {s.deliverable}
                </p>
              </div>
            ))}
          <p className="text-[11px] text-fg-muted">
            Deliverables are AI-generated drafts — review and confirm before anything goes to LPs or
            the books.
          </p>
        </div>
      ) : phase === "done" ? (
        <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
          Nothing came back this round. Try refining the request.
        </p>
      ) : null}
    </div>
  );
}
