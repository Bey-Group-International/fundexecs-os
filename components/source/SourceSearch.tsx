"use client";

import { useEffect, useRef, useState } from "react";
import {
  startSourceSearch,
  runSourceStep,
  completeSourceSearch,
  type SearchStep,
} from "@/app/(app)/[hub]/[module]/source-search-actions";
import { addSourcedTargets } from "@/app/(app)/[hub]/[module]/source-ai-actions";
import { AGENT_BY_KEY } from "@/lib/agents";
import { buildSourceSelectionPayload } from "@/lib/source-selection";
import { EntityDedupe } from "@/lib/source-identity";
import type { VerificationStatus, VerifiedCandidate } from "@/lib/source-verification";
import type { MandateFit, ScoredCandidate } from "@/lib/source-fit";
import type { AgentKey } from "@/lib/supabase/database.types";

type StepStatus = "queued" | "running" | "done" | "error";
interface LiveStep extends SearchStep {
  status: StepStatus;
  count?: number;
  candidates?: (VerifiedCandidate & ScoredCandidate)[];
  cached?: boolean;
  refreshing?: boolean;
}
type Phase = "idle" | "planning" | "running" | "done";

// How many agent steps run at once. Steps are independent, so running them in
// sequence just multiplied one step's latency by the size of the plan. Three at
// a time takes a four-step search down to roughly two steps' wall-clock without
// bursting the model or Apollo rate limits.
const STEP_CONCURRENCY = 3;

// What each verification status means to the operator, in their language.
const VERIFICATION_UI: Record<VerificationStatus, { label: string; title: string; className: string }> = {
  verified: {
    label: "verified",
    title: "Firm and contact confirmed against provider records.",
    className: "border-status-success/40 bg-status-success/10 text-status-success",
  },
  corroborated: {
    label: "cited",
    title: "Carries a supporting source link, but no provider record confirmed it.",
    className: "border-status-info/40 bg-status-info/10 text-status-info",
  },
  unverified: {
    label: "lead",
    title: "Generated from model knowledge — confirm before acting on it.",
    className: "border-line bg-surface-2 text-fg-muted",
  },
  flagged: {
    label: "check",
    title: "Failed an internal consistency check — research before outreach.",
    className: "border-status-danger/40 bg-status-danger/10 text-status-danger",
  },
};

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

// Tooltip text for the verification badge: the status in plain language, plus
// whichever checks failed, so "check" is never an unexplained warning.
// Why the fit score is what it is: which mandate constraints this candidate
// meets, which it misses, and which couldn't be checked. Turns an opaque
// percentage into something an operator can argue with.
function fitTitle(c: { fitScore: number; modelFitScore?: number; mandateFit?: MandateFit }): string {
  if (!c.mandateFit || c.mandateFit.coverage === 0) {
    return "Model fit estimate. Nothing in this candidate could be checked against the mandate.";
  }
  const lines = c.mandateFit.signals
    .filter((s) => s.matched !== null)
    .map((s) => `${s.matched ? "\u2713" : "\u2717"} ${s.label}: ${s.detail ?? ""}`.trim());
  const unchecked = c.mandateFit.signals.filter((s) => s.matched === null);
  if (unchecked.length) lines.push(`Not assessed: ${unchecked.map((s) => s.label.toLowerCase()).join(", ")}.`);
  const model = typeof c.modelFitScore === "number" && c.modelFitScore !== c.fitScore
    ? ` Blended from a ${c.modelFitScore}% model estimate and ${c.mandateFit.score}% mandate overlap.`
    : "";
  return `${lines.join(" ")}${model}`;
}

// A compact mandate-overlap read for the row: ✓/✗ per assessed constraint.
function fitChips(c: { mandateFit?: MandateFit }): { label: string; matched: boolean }[] {
  return (c.mandateFit?.signals ?? [])
    .filter((s): s is typeof s & { matched: boolean } => s.matched !== null)
    .map((s) => ({ label: s.label, matched: s.matched }));
}

function verificationTitle(c: VerifiedCandidate): string {
  const base = VERIFICATION_UI[c.verification.status].title;
  const failed = c.verification.checks.filter((k) => !k.ok && k.detail).map((k) => k.detail);
  const confidence = `Confidence ${Math.round(c.verification.confidence * 100)}%.`;
  return [base, confidence, ...failed].join(" ");
}

// The qualifying facts an operator reads first — size, ticket, geography.
function intelLine(c: VerifiedCandidate): string {
  return [
    c.aumRange ? `AUM ${c.aumRange}` : null,
    c.ticketRange ? `ticket ${c.ticketRange}` : null,
    c.geography,
    c.strategies?.length ? c.strategies.slice(0, 3).join(" / ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [personalized, setPersonalized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const ranInitial = useRef(false);
  const workflowRef = useRef<string | null>(null);
  // Mirror of `steps` for the refresh path, which needs the current results
  // without re-creating its callback on every state change. Written in an
  // effect, not during render: React can discard a render it never commits,
  // and the ref would keep the value from that discarded pass.
  const stepsRef = useRef<LiveStep[]>([]);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const busy = phase === "planning" || phase === "running";

  // Fold one step's result into the timeline. Candidates are filtered through a
  // dedupe shared by the whole run, so when two modules surface the same firm
  // the operator sees it once, under the step that finished first.
  function applyStepResult(
    stepId: string,
    result: Awaited<ReturnType<typeof runSourceStep>>,
    dedupe: EntityDedupe,
  ) {
    const candidates = (result.candidates ?? []).filter((c) => dedupe.add(c.name));
    setSteps((prev) =>
      prev.map((x) =>
        x.id === stepId
          ? {
              ...x,
              status: result.ok ? "done" : "error",
              count: candidates.length,
              candidates,
              cached: Boolean(result.cached),
              refreshing: false,
            }
          : x,
      ),
    );
    // Pre-select every surfaced candidate for quick accept.
    if (result.ok && candidates.length) {
      setSelected((prev) => {
        const next = new Set(prev);
        candidates.forEach((_, i) => next.add(`${stepId}:${i}`));
        return next;
      });
    }
  }

  async function run(p: string) {
    const clean = p.trim();
    if (!clean || busy) return;
    setError(null);
    setPhase("planning");
    setSummary("");
    setSteps([]);
    setSelected(new Set());
    setAdded({});
    setPersonalized(false);

    try {
      const res = await startSourceSearch(clean);
      if (!res.ok || !res.workflowId || !res.steps) {
        setError(res.error ?? "Could not start the search.");
        setPhase("idle");
        return;
      }
      const workflowId = res.workflowId;
      workflowRef.current = workflowId;
      const planned = res.steps;
      setSessionId(res.sessionId ?? null);
      setPersonalized(Boolean(res.personalized));
      setSummary(res.summary ?? "");
      setSteps(planned.map((s) => ({ ...s, status: "queued" as StepStatus })));
      setPhase("running");

      // Each step is its own agent working its own module — nothing downstream
      // depends on the step before it, so they run together behind a small
      // worker pool rather than one at a time.
      const dedupe = new EntityDedupe();
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          const index = cursor++;
          if (index >= planned.length) return;
          const step = planned[index];
          setSteps((prev) => prev.map((x) => (x.id === step.id ? { ...x, status: "running" } : x)));
          let r: Awaited<ReturnType<typeof runSourceStep>>;
          try {
            r = await runSourceStep({
              workflowId,
              stepId: step.id,
              module: step.module,
              query: step.query,
            });
          } catch {
            r = { ok: false };
          }
          applyStepResult(step.id, r, dedupe);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(STEP_CONCURRENCY, planned.length) }, worker),
      );

      await completeSourceSearch(workflowId);
      setPhase("done");
    } catch {
      setError("The search did not finish. Please try again.");
      setPhase("idle");
    }
  }

  // Re-run a single step against a fresh generation, bypassing the cache. The
  // freshness chip tells the operator when a set came from cache; this is how
  // they get past it without re-running the whole plan.
  async function refreshStep(step: LiveStep) {
    const workflowId = workflowRef.current;
    if (!workflowId || step.refreshing) return;
    setSteps((prev) => prev.map((x) => (x.id === step.id ? { ...x, refreshing: true } : x)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of next) if (key.startsWith(`${step.id}:`)) next.delete(key);
      return next;
    });
    try {
      const r = await runSourceStep({
        workflowId,
        stepId: step.id,
        module: step.module,
        query: step.query,
        refresh: true,
      });
      if (!r.ok) {
        // runSourceStep reports failure by returning, not by throwing. Passing
        // that to applyStepResult would replace the step with an empty list and
        // silently bin results the operator still had.
        setError(r.error ?? "Could not refresh that step.");
        setSteps((prev) => prev.map((x) => (x.id === step.id ? { ...x, refreshing: false } : x)));
        return;
      }
      // A refresh replaces this step's results, so the names it previously
      // surfaced must not keep blocking themselves in the run-wide dedupe.
      const dedupe = new EntityDedupe();
      for (const other of stepsRef.current) {
        if (other.id === step.id) continue;
        for (const c of other.candidates ?? []) dedupe.add(c.name);
      }
      applyStepResult(step.id, r, dedupe);
    } catch {
      setError("Could not refresh that step.");
      setSteps((prev) => prev.map((x) => (x.id === step.id ? { ...x, refreshing: false } : x)));
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

  const toggle = (kbn: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kbn)) next.delete(kbn);
      else next.add(kbn);
      return next;
    });

  async function addGroup(step: LiveStep) {
    if (!step.candidates || added[step.id] != null || adding.has(step.id)) return;
    const { picks, rejected } = buildSourceSelectionPayload(step.candidates, (_, i) => selected.has(`${step.id}:${i}`));
    if (picks.length === 0) return;
    // The surfaced-but-skipped candidates are a reject signal — recording them
    // alongside the picks is what teaches the engine this operator's taste.
    const moduleKey = step.module.replace(/^source\//, "");
    setAdding((prev) => new Set(prev).add(step.id));
    try {
      const res = await addSourcedTargets("source", moduleKey, picks, { query: step.query, rejected, sessionId });
      if (res.ok) setAdded((prev) => ({ ...prev, [step.id]: res.added ?? picks.length }));
      else setError(res.error ?? "Could not add to pipeline.");
    } catch {
      setError("Could not add to pipeline.");
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(step.id);
        return next;
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
            ✶ AI Sourcing Search
          </span>
          {!live ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              offline mode
            </span>
          ) : webEnrichment ? (
            <span className="rounded-full border border-status-info/40 bg-status-info/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-status-info">
              web ⚡
            </span>
          ) : null}
          {personalized ? (
            <span
              title="Tuned by what you've accepted and skipped before"
              className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-gold-300"
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
            className="shrink-0 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-on-gold transition hover:bg-gold-300 disabled:opacity-50"
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
                  <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider">
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
                <span className="font-mono text-[11px] text-fg-muted">{s.agentName}</span>
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
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-gold-300">
                      {humanize(s.entities)} · {s.agentName}
                    </span>
                    <div className="flex items-center gap-2">
                      {s.cached ? (
                        <span
                          title="Returned from a recent identical search. Refresh for a new generation."
                          className="font-mono text-[11px] uppercase tracking-wider text-fg-muted"
                        >
                          cached
                        </span>
                      ) : null}
                      {added[s.id] == null ? (
                        <button
                          type="button"
                          onClick={() => refreshStep(s)}
                          disabled={s.refreshing}
                          className="font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300 disabled:opacity-50"
                        >
                          {s.refreshing ? "refreshing…" : "↻ refresh"}
                        </button>
                      ) : (
                        <span className="font-mono text-[11px] uppercase tracking-wider text-status-success">
                          ✓ added {added[s.id]}
                        </span>
                      )}
                    </div>
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
                              <span
                                title={fitTitle(c)}
                                className={`shrink-0 font-mono text-xs ${scoreTone(c.fitScore)}`}
                              >
                                {c.fitScore}% fit
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                                {humanize(c.category)}
                              </span>
                              {/* What the system could confirm before showing this row. */}
                              <span
                                title={verificationTitle(c)}
                                className={`rounded-full border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider ${VERIFICATION_UI[c.verification.status].className}`}
                              >
                                {VERIFICATION_UI[c.verification.status].label}
                              </span>
                              {/* Which mandate constraints this target actually meets. */}
                              {fitChips(c).map((chip) => (
                                <span
                                  key={chip.label}
                                  className={`font-mono text-[10px] uppercase tracking-wider ${chip.matched ? "text-status-success" : "text-fg-muted line-through"}`}
                                >
                                  {chip.matched ? "\u2713" : "\u2717"} {chip.label}
                                </span>
                              ))}
                            </div>
                            <p className="mt-1 text-xs text-fg-secondary">{c.rationale}</p>
                            {/* Pre-review intel, so the operator can qualify without leaving the page. */}
                            {intelLine(c) ? (
                              <p className="mt-1 font-mono text-[11px] text-fg-muted">{intelLine(c)}</p>
                            ) : null}
                            {c.contactName ? (
                              <p className="mt-1 text-[11px] text-fg-secondary">
                                {c.contactName}
                                {c.contactRole ? ` · ${c.contactRole}` : ""}
                                {c.contactEmail ? ` · ${c.contactEmail}` : ""}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-gold-300">→ {c.firstMove}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              {c.sourceUrl ? (
                                <a
                                  href={c.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="max-w-full truncate font-mono text-[11px] text-status-info hover:underline"
                                >
                                  ↗ source
                                </a>
                              ) : null}
                              {c.website ? (
                                <a
                                  href={c.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="max-w-full truncate font-mono text-[11px] text-status-info hover:underline"
                                >
                                  ↗ website
                                </a>
                              ) : null}
                              {c.contactLinkedIn ? (
                                <a
                                  href={c.contactLinkedIn}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="max-w-full truncate font-mono text-[11px] text-status-info hover:underline"
                                >
                                  ↗ linkedin
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {added[s.id] == null ? (
                    <button
                      type="button"
                      onClick={() => addGroup(s)}
                      className="mt-3 rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-on-gold transition hover:bg-gold-300 disabled:opacity-50"
                      disabled={groupSel === 0 || adding.has(s.id)}
                    >
                      {adding.has(s.id) ? "Adding…" : `Add ${groupSel} to pipeline`}
                    </button>
                  ) : null}
                </div>
              );
            })}
        </div>
      ) : phase === "done" ? (
        <p className="mt-6 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm text-fg-secondary">
          No matches this round. Try refining the request or widening the mandate.
        </p>
      ) : null}
    </div>
  );
}
