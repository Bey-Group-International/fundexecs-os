"use client";

import { useEffect, useRef, useState } from "react";
import {
  runTriage,
  type TriageGroup,
} from "@/app/(app)/[hub]/[module]/source-triage-actions";
import { queueSourceAction } from "@/app/(app)/[hub]/[module]/source-ai-actions";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { ActionKind } from "@/lib/gates";

type Phase = "idle" | "running" | "done";

const EXAMPLES = [
  "Which LPs should I chase this week?",
  "Triage stalled deals",
  "Who in my bench is dormant?",
];

function scoreTone(score: number): string {
  if (score >= 70) return "text-status-success";
  if (score >= 45) return "text-gold-300";
  return "text-fg-muted";
}
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Conversational pipeline triage — describe what to triage, Earn ranks the rows
// already in the pipeline (per module) with a recommended next move each, and
// every queued action runs through the approval gate (queueSourceAction).
export function SourceTriage({
  live,
  initialPrompt,
}: {
  live: boolean;
  initialPrompt?: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [summary, setSummary] = useState("");
  const [groups, setGroups] = useState<TriageGroup[]>([]);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [personalized, setPersonalized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranInitial = useRef(false);

  const busy = phase === "running";

  async function run(p: string) {
    const clean = p.trim();
    if (!clean || busy) return;
    setError(null);
    setPhase("running");
    setSummary("");
    setGroups([]);
    setQueued(new Set());
    setNotes({});
    setPersonalized(false);

    try {
      const res = await runTriage(clean);
      if (!res.ok || !res.groups) {
        setError(res.error ?? "Could not run the triage.");
        setPhase("idle");
        return;
      }
      setPersonalized(Boolean(res.personalized));
      setSummary(res.summary ?? "");
      setGroups(res.groups);
      setPhase("done");
    } catch {
      setError("Could not run the triage.");
      setPhase("idle");
    }
  }

  // Auto-run when arriving with a prefilled query (e.g. from a module panel).
  useEffect(() => {
    if (initialPrompt && !ranInitial.current) {
      ranInitial.current = true;
      run(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function queue(group: TriageGroup, id: string, name: string, action: ActionKind, label: string) {
    const key = `${group.module}:${id}`;
    if (queued.has(key) || queueing.has(key)) return;
    setQueueing((prev) => new Set(prev).add(key));
    try {
      const res = await queueSourceAction({
        hub: "source",
        module: group.module.replace(/^source\//, ""),
        name,
        email: group.rowEmail[id],
        action,
        label,
      });
      if (!res.ok) {
        setNotes((prev) => ({ ...prev, [key]: res.error ?? "Could not queue the action." }));
        return;
      }
      setQueued((prev) => new Set(prev).add(key));
      setNotes((prev) => ({ ...prev, [key]: res.message ?? "Queued." }));
    } catch {
      setNotes((prev) => ({ ...prev, [key]: "Could not queue the action." }));
    } finally {
      setQueueing((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const hasResults = groups.some((g) => g.scores.length > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
            ✶ Score &amp; Triage
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              offline mode
            </span>
          ) : null}
          {personalized ? (
            <span
              title="Tuned by what you've queued and accepted before"
              className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300"
            >
              ✦ personalized
            </span>
          ) : null}
        </div>
      </header>

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
          placeholder="e.g. Which LPs should I chase this week?"
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
            {busy ? "Triaging…" : "Triage"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-3 rounded-md border border-status-danger/40 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      {/* Earn's brief */}
      {summary ? (
        <div className="mt-5 flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: AGENT_BY_KEY.associate.color }}
            aria-hidden
          />
          <span className="text-fg-primary">{summary}</span>
        </div>
      ) : null}

      {/* Grouped, ranked results */}
      {hasResults ? (
        <div className="mt-5 space-y-4">
          {groups
            .filter((g) => g.scores.length > 0)
            .map((g) => (
              <div key={g.module} className="rounded-2xl border border-line bg-surface-1 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: AGENT_BY_KEY[g.agent]?.color ?? "#888" }}
                    aria-hidden
                  />
                  <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                    {humanize(g.entities)} · {g.agentName}
                  </span>
                </div>
                <div className="space-y-2">
                  {g.scores.map((s) => {
                    const key = `${g.module}:${s.id}`;
                    const isQueued = queued.has(key);
                    const isQueueing = queueing.has(key);
                    return (
                      <div
                        key={s.id}
                        className="flex items-start gap-3 rounded-xl border border-line bg-surface-0/40 p-3"
                      >
                        <span
                          className={`mt-0.5 w-10 shrink-0 font-mono text-sm font-semibold ${scoreTone(s.fitScore)}`}
                        >
                          {s.fitScore}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg-primary">
                            {s.name}
                          </span>
                          <p className="mt-0.5 text-xs text-fg-secondary">{s.rationale}</p>
                          {notes[key] ? (
                            <p className="mt-1 text-[11px] text-gold-300">{notes[key]}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => queue(g, s.id, s.name, s.action as ActionKind, s.actionLabel)}
                          disabled={isQueued || isQueueing}
                          className="shrink-0 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-200 transition hover:bg-gold-500/20 disabled:opacity-50"
                        >
                          {isQueued ? "Queued ✓" : isQueueing ? "Queueing…" : `Queue: ${s.actionLabel}`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      ) : phase === "done" ? (
        <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
          Nothing to triage in those modules yet. Add rows to the pipeline, then come back.
        </p>
      ) : null}
    </div>
  );
}
