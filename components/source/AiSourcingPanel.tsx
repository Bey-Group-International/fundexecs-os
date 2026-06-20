"use client";

import { useState, useTransition } from "react";
import {
  sourceTargets,
  addSourcedTargets,
  scorePipeline,
  queueSourceAction,
} from "@/app/(app)/[hub]/[module]/source-ai-actions";
import type { SourceCandidate, PipelineScore } from "@/lib/source-ai";
import type { ActionKind } from "@/lib/gates";

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreTone(score: number): string {
  if (score >= 70) return "text-status-success";
  if (score >= 45) return "text-gold-300";
  return "text-fg-muted";
}

type Mode = "idle" | "generate" | "score";

// In-module AI Sourcing surface: generate thesis-fit targets (review-and-accept
// into the pipeline) and score the targets already there with a gated next-best
// move. Backed by lib/source-ai + source-ai-actions; degrades to deterministic
// output when no model key is present.
export function AiSourcingPanel({
  hub,
  module,
  entities,
  agentName,
  live,
}: {
  hub: string;
  module: string;
  entities: string;
  agentName: string;
  live: boolean;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [pending, start] = useTransition();
  const [candidates, setCandidates] = useState<SourceCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scores, setScores] = useState<PipelineScore[] | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const runGenerate = () => {
    setMode("generate");
    setMessage(null);
    setScores(null);
    start(async () => {
      const res = await sourceTargets(hub, module);
      if (!res.ok) return setMessage(res.error ?? "Could not source targets.");
      setCandidates(res.candidates ?? []);
      setSelected(new Set((res.candidates ?? []).map((_, i) => i)));
    });
  };

  const runScore = () => {
    setMode("score");
    setMessage(null);
    setCandidates(null);
    start(async () => {
      const res = await scorePipeline(hub, module);
      if (!res.ok) return setMessage(res.error ?? "Could not score the pipeline.");
      setScores(res.scores ?? []);
      if ((res.scores ?? []).length === 0) setMessage(`No ${entities} to score yet.`);
    });
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const addSelected = () => {
    if (!candidates) return;
    const picks = candidates.filter((_, i) => selected.has(i)).map((c) => ({
      name: c.name,
      category: c.category,
      rationale: c.rationale,
    }));
    if (picks.length === 0) return setMessage("Select at least one to add.");
    start(async () => {
      const res = await addSourcedTargets(hub, module, picks);
      if (!res.ok) return setMessage(res.error ?? "Could not add to pipeline.");
      setMessage(`Added ${res.added} to the pipeline.`);
      setCandidates(null);
      setMode("idle");
    });
  };

  const queue = (s: PipelineScore, email?: string) => {
    start(async () => {
      const res = await queueSourceAction({
        hub,
        module,
        name: s.name,
        email,
        action: s.action as ActionKind,
        label: s.actionLabel,
      });
      if (!res.ok) return setMessage(res.error ?? "Could not queue the action.");
      setQueued((prev) => new Set(prev).add(s.id));
      setMessage(res.message ?? "Queued.");
    });
  };

  return (
    <div className="mb-5 rounded-2xl border border-gold-500/25 bg-gradient-to-b from-gold-500/[0.06] to-transparent p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
          ✶ AI Sourcing
        </span>
        <span className="text-xs text-fg-muted">· {agentName}</span>
        {!live ? (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            offline mode
          </span>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={runGenerate}
            disabled={pending}
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-200 transition hover:bg-gold-500/20 disabled:opacity-50"
          >
            Source targets
          </button>
          <button
            type="button"
            onClick={runScore}
            disabled={pending}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface-2 disabled:opacity-50"
          >
            Score pipeline
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-fg-secondary">
        Propose thesis-fit {entities} to add, or score the pipeline and queue the next move — every
        outbound action runs through your approval gate.
      </p>

      {pending ? <p className="mt-3 animate-pulse text-xs text-gold-300">Working…</p> : null}
      {message ? (
        <p className="mt-3 rounded-md border border-line bg-surface-1 px-3 py-2 text-xs text-fg-primary">
          {message}
        </p>
      ) : null}

      {/* Generate: review-and-accept */}
      {mode === "generate" && candidates && candidates.length > 0 ? (
        <div className="mt-3 space-y-2">
          {candidates.map((c, i) => (
            <label
              key={`${c.name}-${i}`}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-1 p-3 transition hover:border-gold-500/40"
            >
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => toggle(i)}
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
              </div>
            </label>
          ))}
          <button
            type="button"
            onClick={addSelected}
            disabled={pending}
            className="mt-1 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
          >
            Add {selected.size} to pipeline
          </button>
        </div>
      ) : null}

      {/* Score: ranked rows with a gated next action */}
      {mode === "score" && scores && scores.length > 0 ? (
        <div className="mt-3 space-y-2">
          {scores.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-3"
            >
              <span className={`mt-0.5 w-10 shrink-0 font-mono text-sm font-semibold ${scoreTone(s.fitScore)}`}>
                {s.fitScore}
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg-primary">{s.name}</span>
                <p className="mt-0.5 text-xs text-fg-secondary">{s.rationale}</p>
              </div>
              <button
                type="button"
                onClick={() => queue(s)}
                disabled={pending || queued.has(s.id)}
                className="shrink-0 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-200 transition hover:bg-gold-500/20 disabled:opacity-50"
              >
                {queued.has(s.id) ? "Queued ✓" : s.actionLabel}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
