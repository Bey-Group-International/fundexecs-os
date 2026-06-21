"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Task, Approval, Artifact } from "@/lib/supabase/database.types";
import { ArtifactInline, ARTIFACT_LABEL } from "@/components/ArtifactViewer";
import { EarnOrb } from "@/components/copilot/EarnOrb";
import { EARN_MODELS, buildEarnPromptEnvelope, type EarnAttachmentInput, type EarnModelKey } from "@/lib/earn-conversation";
import { activeAgent, buildAgentTheater, type AgentTheaterNode } from "@/lib/session-theater";

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
  const [model, setModel] = useState<EarnModelKey>("claude");
  const [attachments, setAttachments] = useState<EarnAttachmentInput[]>([]);
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [clarifying, setClarifying] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<{ workflowId: string; questions: string[]; answer: string } | null>(null);
  const [, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep the newest turn in view as the conversation grows — chat behavior.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bundles.length, planning]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 56), 176);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > 176 ? "auto" : "hidden";
  }, [prompt]);

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
    setComposerError(null);
    const envelope = buildEarnPromptEnvelope({ body, model, attachments, voiceUsed });
    setBusy(true);
    setPlanning(true);
    setPrompt("");
    setAttachments([]);
    setVoiceUsed(false);
    const res = await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionId ? { body: envelope, session_id: sessionId } : { body: envelope }),
    }).catch(() => null);
    setBusy(false);
    setPlanning(false);

    if (!res?.ok) {
      setPrompt(body);
      setComposerError("Earn could not start that run. Check your session and try again.");
      return;
    }

    // From the launcher (no session yet), the prompt opens a session — follow
    // it in, Claude Code style, so the work continues at /session/<id>. Inside
    // a session we just refresh to surface the new workflow in place.
    if (!sessionId) {
      const data = await res.json().catch(() => null);
      if (data?.session_id) {
        router.push(`/session/${data.session_id}`);
        return;
      }
    }
    startTransition(() => router.refresh());
  }

  async function decide(
    approvalId: string,
    decision: "approved" | "rejected" | "regenerate" | "accepted",
    note?: string,
  ) {
    setBusy(true);
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, decision, note }),
    }).catch(() => {});
    setClarify(null);
    setBusy(false);
    startTransition(() => router.refresh());
  }

  // "Ask questions to complete" — Earn surfaces what it needs to know. The
  // operator's answers refine the plan (a re-gated regenerate).
  async function askQuestions(workflowId: string) {
    setClarifying(true);
    const res = await fetch("/api/clarify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow_id: workflowId }),
    }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    const questions: string[] = Array.isArray(data?.questions) ? data.questions : [];
    setClarify({ workflowId, questions, answer: "" });
    setClarifying(false);
  }

  // Conversation order: oldest turn first, newest nearest the composer.
  const turns = [...bundles].reverse();
  const empty = turns.length === 0 && !planning;
  const theaterBundle =
    turns.find((b) => b.workflow.status === "in_progress" || b.workflow.status === "awaiting_approval") ??
    turns[turns.length - 1] ??
    null;

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setAttachments((prev) => [
      ...prev,
      ...Array.from(files)
        .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
        .map((file) => ({ name: file.name, type: file.type, size: file.size })),
    ].slice(0, 6));
  }

  function startVoice() {
    type SpeechRecognitionLike = {
      lang: string;
      interimResults: boolean;
      onstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      start: () => void;
    };
    type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setPrompt((p) => `${p}${p ? "\n" : ""}[Voice input unavailable in this browser.]`);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) {
        setVoiceUsed(true);
        setPrompt((p) => `${p}${p ? "\n" : ""}${transcript}`);
      }
    };
    recognition.start();
  }

  return (
    <div className="fx-neural-ambient mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl flex-col">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <EarnOrb size={30} pulse={live || planning} />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold-400">
              FundExecs OS · Earn
            </p>
            <h1 className="font-display text-lg font-semibold tracking-tight text-fg-primary">
              Agent chat
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-line/80 bg-surface-1/70 px-3 py-1.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-status-success shadow-[0_0_12px_rgb(95_184_122/0.75)]" : "bg-fg-muted"}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {live ? "Earn ready" : "Fallback mode"}
          </span>
        </div>
      </header>

      <section className="relative flex min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-line/80 bg-surface-0/88 shadow-[0_24px_90px_-58px_rgb(var(--fx-accent-rgb)/0.9)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(var(--fx-accent-rgb)/0.16),transparent_36%),linear-gradient(rgb(var(--fx-accent-rgb)/0.045)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--fx-accent-rgb)/0.045)_1px,transparent_1px)] bg-[length:auto,32px_32px,32px_32px]"
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {theaterBundle ? (
                <AgentWorkspace bundle={theaterBundle} planning={planning} model={model} />
              ) : null}

              {empty ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center px-4 py-14 text-center">
                  <EarnOrb size={54} pulse />
                  <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-fg-primary">
                    What should Earn run?
                  </h2>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-fg-secondary">
                    Ask for diligence, sourcing, LP work, or fund operations. Earn drafts the plan, shows the agent lanes, and waits at the gate before automation.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {["LBO model", "LP update", "Source family offices", "Review mandate"].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => {
                          setPrompt(chip);
                          inputRef.current?.focus();
                        }}
                        className="rounded-full border border-line/80 bg-surface-1/75 px-3 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {turns.map((b) => (
                <div key={b.workflow.id} className="flex flex-col gap-4">
                  <div className="flex justify-end gap-3">
                    <div className="max-w-[84%]">
                      <div className="mb-1 flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        You
                      </div>
                      <div className="whitespace-pre-wrap rounded-2xl rounded-br-md border border-line/70 bg-surface-2/80 px-4 py-3 text-sm leading-6 text-fg-primary shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
                        {b.workflow.description || b.workflow.title}
                      </div>
                    </div>
                    <span className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-1 font-mono text-[10px] font-semibold text-gold-300">
                      YOU
                    </span>
                  </div>

                  <div className="flex gap-3">
                    <EarnOrb size={32} pulse={b.workflow.status === "in_progress" || b.workflow.status === "awaiting_approval"} className="mt-5" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        Earn
                        <span className="h-1 w-1 rounded-full bg-line" />
                        <span>{STATUS_LABEL[b.workflow.status] ?? b.workflow.status}</span>
                      </div>
                      <WorkflowCard
                        bundle={b}
                        busy={busy}
                        decide={decide}
                        primary={b.approval?.decision === "pending"}
                        clarifying={clarifying}
                        clarify={clarify?.workflowId === b.workflow.id ? clarify : null}
                        onAsk={() => askQuestions(b.workflow.id)}
                        onAnswerChange={(v) => setClarify((c) => (c ? { ...c, answer: v } : c))}
                        onCancelClarify={() => setClarify(null)}
                      />
                    </div>
                  </div>
                </div>
              ))}

              {planning ? (
                <div className="flex gap-3">
                  <EarnOrb size={32} pulse className="mt-1" />
                  <div className="relative overflow-hidden rounded-2xl border border-gold-500/25 bg-surface-1/80 px-4 py-3 text-sm text-fg-secondary">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400" />
                      Reading your prompt and drafting the plan...
                    </span>
                    <span className="fx-data-stream" aria-hidden />
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </div>

          <form
            onSubmit={submit}
            className="border-t border-line/75 bg-surface-0/88 p-3 backdrop-blur-xl supports-[backdrop-filter]:bg-surface-0/72 sm:p-4"
          >
            <div className="mx-auto max-w-3xl rounded-2xl border border-line/85 bg-surface-1/85 p-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),0_18px_50px_-38px_rgb(var(--fx-accent-rgb)/0.85)] transition focus-within:border-gold-500/60">
              {attachments.length ? (
                <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                  {attachments.map((file, i) => (
                    <button
                      key={`${file.name}-${i}`}
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, index) => index !== i))}
                      className="rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-1 font-mono text-[10px] text-gold-300 transition hover:bg-gold-500/15"
                      title="Remove attachment"
                    >
                      {file.type.startsWith("video/") ? "video" : "image"} · {file.name} x
                    </button>
                  ))}
                </div>
              ) : null}

              <textarea
                ref={inputRef}
                value={prompt}
                rows={2}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (composerError) setComposerError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={
                  sessionId
                    ? "Reply to Earn..."
                    : "Ask Earn to build the LBO model, test debt capacity, or draft an LP update..."
                }
                className="max-h-44 min-h-[56px] w-full resize-none rounded-xl border-0 bg-transparent px-3 py-2.5 text-sm leading-6 text-fg-primary outline-none placeholder:text-fg-muted"
              />

              <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-1 pt-2">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as EarnModelKey)}
                  className="h-8 rounded-lg border border-line bg-surface-0/80 px-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-secondary outline-none transition hover:border-gold-500/45 focus:border-gold-500/70"
                  aria-label="Reasoning model"
                >
                  {EARN_MODELS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>

                <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface-0/80 px-2.5 text-xs text-fg-secondary transition hover:border-gold-500/45 hover:text-fg-primary">
                  <span className="font-mono text-[11px]">+</span>
                  Context
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={startVoice}
                  className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition ${
                    listening
                      ? "border-status-danger/50 bg-status-danger/10 text-status-danger"
                      : "border-line bg-surface-0/80 text-fg-secondary hover:border-gold-500/45 hover:text-fg-primary"
                  }`}
                  title="Speak to Earn"
                >
                  <span className="font-mono text-[11px]">{listening ? "●" : "mic"}</span>
                  {listening ? "Listening" : "Voice"}
                </button>

                <span className="ml-auto hidden font-mono text-[10px] text-fg-muted sm:inline">
                  Enter to send · Shift+Enter for newline
                </span>
                <button
                  disabled={busy || !prompt.trim()}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-gold-400 px-3 text-xs font-semibold text-surface-0 shadow-[0_0_18px_rgb(var(--fx-accent-rgb)/0.24)] transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {planning ? "Planning" : sessionId ? "Send" : "Run"}
                  <span aria-hidden>→</span>
                </button>
              </div>
              {composerError ? (
                <p className="px-1 pt-2 text-xs text-status-danger">{composerError}</p>
              ) : null}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

const THEATER_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  active: "Computing",
  waiting: "Awaiting approval",
  done: "Complete",
  blocked: "Needs attention",
};

function AgentWorkspace({
  bundle,
  planning,
  model,
}: {
  bundle: WorkflowBundle;
  planning: boolean;
  model: EarnModelKey;
}) {
  const nodes = useMemo(() => buildAgentTheater(bundle.steps), [bundle.steps]);
  const [selected, setSelected] = useState(() => activeAgent(nodes));
  const active = nodes.find((node) => node.agent === selected) ?? nodes[0];
  const modelLabel = EARN_MODELS.find((m) => m.key === model)?.label ?? "Claude";

  useEffect(() => {
    const next = activeAgent(nodes);
    if (next) setSelected((current) => (current && nodes.some((node) => node.agent === current) ? current : next));
  }, [bundle.workflow.id, bundle.workflow.status, nodes]);

  if (!nodes.length && !planning) return null;

  return (
    <section className="mb-5 overflow-hidden rounded-3xl border border-gold-500/20 bg-[radial-gradient(circle_at_20%_20%,rgb(var(--fx-accent-rgb)/0.16),transparent_30%),linear-gradient(135deg,rgb(var(--fx-surface-1)/0.94),rgb(var(--fx-surface-0)/0.98))] p-4 shadow-[0_20px_80px_-48px_rgb(var(--fx-accent-rgb)/0.7)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold-300">
            Live Earn Workspace
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-fg-primary">{bundle.workflow.title}</h2>
        </div>
        <div className="rounded-full border border-gold-500/30 bg-black/35 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-200">
          {modelLabel} driving reasoning
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="relative min-h-[240px] overflow-hidden rounded-2xl border border-white/10 bg-black/35 p-4">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[length:32px_32px]" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold-500/20" />
          <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-3">
            {nodes.map((node, index) => (
              <button
                key={node.agent}
                type="button"
                onClick={() => setSelected(node.agent)}
                className={`group rounded-2xl border bg-black/40 p-3 text-left transition hover:border-gold-500/50 ${
                  selected === node.agent ? "border-gold-500/60 shadow-[0_0_28px_-18px_rgb(var(--fx-accent-rgb)/0.9)]" : "border-white/10"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/15" style={{ backgroundColor: `${node.color}22` }}>
                    {node.status === "active" ? (
                      <span className="absolute h-11 w-11 animate-ping rounded-full opacity-20" style={{ backgroundColor: node.color }} />
                    ) : null}
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: node.color }} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg-primary">{node.name}</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      {THEATER_STATUS_LABEL[node.status]}
                    </span>
                  </span>
                </span>
                <span className="mt-3 block h-1 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full transition-all" style={{ width: `${Math.round(node.progress * 100)}%`, backgroundColor: node.color }} />
                </span>
                <span className="mt-2 block truncate text-xs text-fg-secondary">
                  {index === 0 && planning ? "Earn is forming the plan..." : node.activeTitle}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/45 p-4">
          {active ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-fg-primary">{active.name}</p>
                  <p className="mt-1 text-xs text-fg-muted">{active.role}</p>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {active.motionStyle}
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {active.computations.map((line, i) => (
                  <div key={line} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-fg-secondary">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] text-black" style={{ backgroundColor: active.color }}>
                      {i + 1}
                    </span>
                    {line}
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-gold-500/20 bg-gold-500/[0.06] p-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-gold-300">Inspectable progress</p>
                <p className="mt-1 text-xs text-fg-secondary">
                  {active.stepCount} task{active.stepCount === 1 ? "" : "s"} · {Math.round(active.progress * 100)}% complete · click any avatar to inspect its computation lane.
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-fg-muted">Earn is preparing the executive team.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function WorkflowSteps({ bundle }: { bundle: WorkflowBundle }) {
  const { steps, artifacts } = bundle;
  const artifactByStep = new Map<string, Artifact>();
  for (const a of artifacts) if (a.step_id) artifactByStep.set(a.step_id, a);
  return (
    <ol className="relative flex flex-col gap-2.5">
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
          <li key={step.id} className="flex gap-3 rounded-xl border border-line/60 bg-surface-0/45 px-3 py-2.5">
            <div className="flex flex-col items-center">
              <StepNode status={step.status} color={agent?.color} />
              {i < steps.length - 1 ? <span className="mt-1 w-px flex-1 bg-line/80" /> : null}
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
  clarifying,
  clarify,
  onAsk,
  onAnswerChange,
  onCancelClarify,
}: {
  bundle: WorkflowBundle;
  busy: boolean;
  decide: (id: string, d: "approved" | "rejected" | "regenerate" | "accepted", note?: string) => void;
  primary?: boolean;
  clarifying: boolean;
  clarify: { questions: string[]; answer: string } | null;
  onAsk: () => void;
  onAnswerChange: (v: string) => void;
  onCancelClarify: () => void;
}) {
  const { workflow, approval } = bundle;
  const pending = approval && approval.decision === "pending";
  return (
    <article className={`rounded-2xl border bg-surface-1/82 p-4 shadow-[0_1px_2px_rgb(0_0_0/0.2)] sm:p-5 ${primary ? "border-gold-500/40 shadow-[0_0_36px_-28px_rgb(var(--fx-accent-rgb)/0.9)]" : "border-line/80"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-fg-primary">{workflow.title}</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {workflow.hub} · {STATUS_LABEL[workflow.status] ?? workflow.status}
          </p>
        </div>
        <div className="w-28 shrink-0 pt-1">
          <div className="mb-1 text-right font-mono text-[9px] text-fg-muted">{Math.round(workflow.progress * 100)}%</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3 shadow-[inset_0_1px_2px_rgb(0_0_0/0.32)]">
            <div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300 transition-all" style={{ width: `${Math.round(workflow.progress * 100)}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-line/65 bg-surface-0/35 p-2.5">
        <WorkflowSteps bundle={bundle} />
      </div>

      {pending ? (
        <div className="mt-4 border-t border-line/75 pt-4">
          <p className="text-xs text-fg-secondary">{approval.summary}</p>

          {/* Clarify panel — Earn's questions for the operator. */}
          {clarify ? (
            <div className="mt-3 rounded-xl border border-gold-500/30 bg-gold-500/[0.06] p-3">
              {clarify.questions.length > 0 ? (
                <>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                    Earn needs to know
                  </p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-fg-secondary">
                    {clarify.questions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-fg-secondary">
                  Earn has no blocking questions — add any extra detail to refine the plan, or just approve.
                </p>
              )}
              <textarea
                value={clarify.answer}
                onChange={(e) => onAnswerChange(e.target.value)}
                rows={3}
                placeholder="Answer Earn — your reply refines the plan…"
                className="mt-2 w-full resize-none rounded-lg border border-line bg-surface-1/85 px-3 py-2 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCancelClarify}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || !clarify.answer.trim()}
                  onClick={() => decide(approval.id, "regenerate", clarify.answer.trim())}
                  className="rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
                >
                  Submit &amp; refine
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(approval.id, "approved")}
              className="rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
            >
              Approve &amp; automate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(approval.id, "accepted")}
              title="Accept the plan as the recommendation — agents won't run"
              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              Accept recommendation
            </button>
            <button
              type="button"
              disabled={busy || clarifying}
              onClick={onAsk}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
            >
              {clarifying ? "Asking…" : "Ask questions"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(approval.id, "regenerate")}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-3 disabled:opacity-50"
            >
              Regenerate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide(approval.id, "rejected")}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-status-danger transition hover:bg-surface-3 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
