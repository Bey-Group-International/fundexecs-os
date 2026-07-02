"use client";

import { useState, useTransition } from "react";
import {
  sourceTargets,
  addSourcedTargets,
  scorePipeline,
  queueSourceAction,
} from "@/app/(app)/[hub]/[module]/source-ai-actions";
import type { SourceCandidate, PipelineScore } from "@/lib/source-ai";
import { buildSourceSelectionPayload } from "@/lib/source-selection";
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
  webEnrichment = false,
}: {
  hub: string;
  module: string;
  entities: string;
  agentName: string;
  live: boolean;
  webEnrichment?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [ask, setAsk] = useState("");
  const [pending, start] = useTransition();
  const [candidates, setCandidates] = useState<SourceCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [scores, setScores] = useState<PipelineScore[] | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");
  const [personalized, setPersonalized] = useState(false);

  const runGenerate = () => {
    setMode("generate");
    setMessage(null);
    setScores(null);
    const query = ask.trim();
    setLastQuery(query);
    start(async () => {
      const res = await sourceTargets(hub, module, query || undefined);
      if (!res.ok) return setMessage(res.error ?? "Could not source targets.");
      setCandidates(res.candidates ?? []);
      setSelected(new Set((res.candidates ?? []).map((_, i) => i)));
      setPersonalized(Boolean(res.personalized));
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
    const { picks, rejected } = buildSourceSelectionPayload(candidates, (_, i) => selected.has(i));
    if (picks.length === 0) return setMessage("Select at least one to add.");
    start(async () => {
      const res = await addSourcedTargets(hub, module, picks, { query: lastQuery || undefined, rejected });
      if (!res.ok) return setMessage(res.error ?? "Could not add to pipeline.");
      const learned = rejected.length ? ` Recorded ${rejected.length} skip signal${rejected.length === 1 ? "" : "s"} for next time.` : "";
      setMessage(`Added ${res.added} to the pipeline.${learned}`);
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
        ) : webEnrichment ? (
          <span className="rounded-full border border-status-info/40 bg-status-info/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-info">
            web ⚡
          </span>
        ) : null}
        {personalized ? (
          <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
            personalized ✦
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

      {/* Conversational entry */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runGenerate();
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder={`Ask Earn to source ${entities}…`}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-3 py-1.5 text-xs text-fg-primary outline-none focus:border-gold-500"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-200 transition hover:bg-gold-500/20"
        >
          ✶ Search
        </button>
      </form>

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
                {/* Intel row — contact, financial, geo details pre-fetched before review */}
                {(c.contactName || c.aumRange || c.ticketRange || c.geography || c.strategies?.length) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {c.contactName && (
                      <span className="font-mono text-[9px] text-fg-muted">
                        {c.contactName}{c.contactRole && <span className="opacity-70"> · {c.contactRole}</span>}
                      </span>
                    )}
                    {c.aumRange && <span className="font-mono text-[9px] text-fg-muted">AUM {c.aumRange}</span>}
                    {c.ticketRange && <span className="font-mono text-[9px] text-fg-muted">Ticket {c.ticketRange}</span>}
                    {c.geography && <span className="font-mono text-[9px] text-fg-muted">{c.geography}</span>}
                    {c.strategies?.slice(0, 2).map((s) => (
                      <span key={s} className="rounded-full border border-line px-1.5 py-0 font-mono text-[8px] text-fg-muted">{s}</span>
                    ))}
                  </div>
                )}
                {(c.contactEmail || c.contactPhone) && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3">
                    {c.contactEmail && (
                      <a href={`mailto:${c.contactEmail}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[9px] text-status-info hover:underline">
                        {c.contactEmail}
                      </a>
                    )}
                    {c.contactPhone && <span className="font-mono text-[9px] text-fg-muted">{c.contactPhone}</span>}
                  </div>
                )}
                {(c.sourceUrl || c.website) && (
                  <div className="mt-0.5 flex flex-wrap gap-x-2">
                    {c.website && (
                      <a href={c.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-[9px] text-fg-muted hover:text-gold-300 hover:underline">
                        {c.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    )}
                    {c.sourceUrl && !c.website && (
                      <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-[10px] text-status-info hover:underline">↗ source</a>
                    )}
                  </div>
                )}
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
