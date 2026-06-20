"use client";

import { useEffect, useRef, useState } from "react";
import {
  startSourceSearch,
  runSourceStep,
  completeSourceSearch,
  type SearchStep,
} from "@/app/(app)/[hub]/[module]/source-search-actions";
import { addSourcedTargets } from "@/app/(app)/[hub]/[module]/source-ai-actions";
import { AGENTS, AGENT_BY_KEY } from "@/lib/agents";
import type { SourceCandidate } from "@/lib/source-ai";
import type { AgentKey } from "@/lib/supabase/database.types";

type StepStatus = "queued" | "running" | "done" | "error";
interface LiveStep extends SearchStep {
  status: StepStatus;
  count?: number;
  candidates?: SourceCandidate[];
}
type Phase = "idle" | "planning" | "running" | "done";

// The Source team: Earn (coordinator) + the five Source-hub agents.
const TEAM = [AGENT_BY_KEY.associate, ...AGENTS.filter((a) => a.hub === "source")];

const EXAMPLES = [
  "Family offices in Texas that back first-time managers",
  "Off-market industrial acquisitions in the Southeast under $20M",
  "Private credit lenders for a value-add real estate strategy",
];

function scoreTone(score: number): string {
  if (score >= 70) return "text-status-success";
  if (score >= 45) return "text-gold-300";
  return "text-fg-muted";
}
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Conversational, agentic sourcing search — describe a target, Earn briefs the
// Source team, each agent works its step in a live timeline, and results come
// back as reviewable candidates that flow into the pipeline (gated + verifiable).
export function SourceSearch({
  live,
  webEnrichment = false,
  initialPrompt,
}: {
  live: boolean;
  webEnrichment?: boolean;
  initialPrompt?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState<LiveStep[]>([]);
  const [activeAgent, setActiveAgent] = useState<AgentKey | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, number>>({});
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
    setSelected(new Set());
    setAdded({});
    setActiveAgent("associate");

    const res = await startSourceSearch(clean);
    if (!res.ok || !res.workflowId || !res.steps) {
      setError(res.error ?? "Could not start the search.");
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
      const r = await runSourceStep({
        workflowId: res.workflowId,
        stepId: s.id,
        module: s.module,
        query: s.query,
      });
      setSteps((prev) =>
        prev.map((x) =>
          x.id === s.id
            ? {
                ...x,
                status: r.ok ? "done" : "error",
                count: r.candidates?.length ?? 0,
                candidates: r.candidates ?? [],
              }
            : x,
        ),
      );
      // Pre-select every returned candidate for quick accept.
      if (r.ok && r.candidates) {
        setSelected((prev) => {
          const next = new Set(prev);
          r.candidates!.forEach((_, i) => next.add(`${s.id}:${i}`));
          return next;
        });
      }
    }

    setActiveAgent(null);
    await completeSourceSearch(res.workflowId);
    setPhase("done");
  }

  // Auto-run when arriving with a prefilled query (e.g. from a module panel).
  useEffect(() => {
    if (initialPrompt && !ranInitial.current) {
      ranInitial.current = true;
      run(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const toggle = (kbn: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kbn)) next.delete(kbn);
      else next.add(kbn);
      return next;
    });

  async function addGroup(step: LiveStep) {
    if (!step.candidates) return;
    const picks = step.candidates
      .filter((_, i) => selected.has(`${step.id}:${i}`))
      .map((c) => ({ name: c.name, category: c.category, rationale: c.rationale, sourceUrl: c.sourceUrl }));
    if (picks.length === 0) return;
    const moduleKey = step.module.replace(/^source\//, "");
    const res = await addSourcedTargets("source", moduleKey, picks);
    if (res.ok) setAdded((prev) => ({ ...prev, [step.id]: res.added ?? picks.length }));
    else setError(res.error ?? "Could not add to pipeline.");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ AI Sourcing Search
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              offline mode
            </span>
          ) : webEnrichment ? (
            <span className="rounded-full border border-status-info/40 bg-status-info/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-info">
              web ⚡
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Describe what you&apos;re looking for. Earn briefs the Source team — each specialist works
          its part, and you review what comes back before anything enters the pipeline.
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
          placeholder="e.g. Family offices in Texas that back first-time managers"
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
            {busy ? "Working…" : "Search"}
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
                      <span className="text-status-success">✓ {s.count} found</span>
                    )}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-fg-muted">{s.agentName}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* Results — reviewable candidate groups */}
      {steps.some((s) => s.status === "done" && (s.candidates?.length ?? 0) > 0) ? (
        <div className="mt-6 space-y-4">
          {steps
            .filter((s) => s.status === "done" && (s.candidates?.length ?? 0) > 0)
            .map((s) => {
              const groupSel = (s.candidates ?? []).filter((_, i) => selected.has(`${s.id}:${i}`)).length;
              return (
                <div key={s.id} className="rounded-2xl border border-line bg-surface-1 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                      {humanize(s.entities)} · {s.agentName}
                    </span>
                    {added[s.id] != null ? (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-status-success">
                        ✓ added {added[s.id]}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {(s.candidates ?? []).map((c, i) => {
                      const kbn = `${s.id}:${i}`;
                      return (
                        <label
                          key={kbn}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-0/40 p-3 transition hover:border-gold-500/40"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(kbn)}
                            onChange={() => toggle(kbn)}
                            disabled={added[s.id] != null}
                            className="mt-0.5 h-4 w-4 accent-gold-400"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium text-fg-primary">{c.name}</span>
                              <span className={`shrink-0 font-mono text-xs ${scoreTone(c.fitScore)}`}>
                                {c.fitScore}% fit
                              </span>
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                              {humanize(c.category)}
                            </div>
                            <p className="mt-1 text-xs text-fg-secondary">{c.rationale}</p>
                            <p className="mt-1 text-[11px] text-gold-300">→ {c.firstMove}</p>
                            {c.sourceUrl ? (
                              <a
                                href={c.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 inline-block max-w-full truncate font-mono text-[10px] text-status-info hover:underline"
                              >
                                ↗ source
                              </a>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {added[s.id] == null ? (
                    <button
                      type="button"
                      onClick={() => addGroup(s)}
                      className="mt-3 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
                      disabled={groupSel === 0}
                    >
                      Add {groupSel} to pipeline
                    </button>
                  ) : null}
                </div>
              );
            })}
          <p className="text-[11px] text-fg-muted">
            Added records land as AI-sourced and unverified — confirm them in the module with the
            evidence link attached.
          </p>
        </div>
      ) : phase === "done" ? (
        <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
          No matches this round. Try refining the request or widening the mandate.
        </p>
      ) : null}
    </div>
  );
}
