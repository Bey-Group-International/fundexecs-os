"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Task, Approval, Artifact } from "@/lib/supabase/database.types";
import { ArtifactInline, ARTIFACT_LABEL } from "@/components/ArtifactViewer";
import { deriveRouting, cursorResponse, routingHeadline } from "@/lib/intelligence";
import { EarnOrb } from "@/components/copilot/EarnOrb";
import {
  EARN_MODELS,
  EARN_MODES,
  DEFAULT_EARN_MODEL,
  DEFAULT_EARN_MODE,
  buildEarnPromptEnvelope,
  type EarnAttachmentInput,
  type EarnModelKey,
  type EarnModeKey,
} from "@/lib/earn-conversation";
import type { ActiveIntegration } from "@/lib/integrations/active";
import { classifyIntent } from "@/lib/intent";

// A conversational turn rendered in the transcript. Chat turns are Earn's
// answer path (ungated) and live in client state alongside the workflow turns.
interface ChatTurn {
  id: string;
  role: "you" | "earn";
  content: string;
  streaming?: boolean;
}

// Slash commands the composer offers from the "+" menu. Selecting one drops a
// ready-to-fill prompt scaffold into the input so the operator only supplies
// the specifics.
const SLASH_COMMANDS: { command: string; label: string; template: string }[] = [
  { command: "/lbo", label: "Build an LBO model", template: "Build an LBO model for " },
  { command: "/source", label: "Source counterparties", template: "Source " },
  { command: "/diligence", label: "Run diligence", template: "Run diligence on " },
  { command: "/stress-test", label: "Stress test", template: "Stress test " },
  { command: "/lp-update", label: "Draft an LP update", template: "Draft an LP update covering " },
  { command: "/memo", label: "Draft an IC memo", template: "Draft an investment committee memo for " },
];

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
  integrations = [],
  initialChat = [],
}: {
  orgId: string;
  live: boolean;
  bundles: WorkflowBundle[];
  // When set, prompts run inside this session and Earn plans with the session's
  // earlier turns in mind. The composer reads as a reply rather than a launch.
  sessionId?: string;
  // The dispatch channels the operator currently has connected — surfaced in the
  // composer's "+" menu so they can see what's active without leaving the page.
  integrations?: ActiveIntegration[];
  // Persisted conversational turns for this session, so Earn's answers survive a
  // reload. Seeds the chat transcript on mount.
  initialChat?: ChatTurn[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<EarnModelKey>(DEFAULT_EARN_MODEL);
  const [mode, setMode] = useState<EarnModeKey>(DEFAULT_EARN_MODE);
  const [attachments, setAttachments] = useState<EarnAttachmentInput[]>([]);
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  // Earn's conversational answers (ungated), interleaved after the workflow
  // turns. Seeded from the session's persisted chat so answers survive a reload.
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>(initialChat);
  const [clarifying, setClarifying] = useState(false);
  const [clarify, setClarify] = useState<{ workflowId: string; questions: string[]; answer: string } | null>(null);
  // Which composer popover is open: the model picker, mode picker, "+" menu, or
  // one of its submenus (slash commands / active integrations).
  const [openMenu, setOpenMenu] = useState<"model" | "mode" | "plus" | "slash" | "integrations" | null>(null);
  // Which integration row in the submenu is expanded to reveal its operational
  // actions.
  const [expandedIntegration, setExpandedIntegration] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const activeModel = EARN_MODELS.find((m) => m.key === model) ?? EARN_MODELS[0];
  const activeMode = EARN_MODES.find((m) => m.key === mode) ?? EARN_MODES[0];

  // Close any open composer popover on an outside click or Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onClick = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // Keep the newest turn in view as the conversation grows — chat behavior.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [bundles.length, planning, chatTurns]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
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

    // Intelligence Layer: a question gets a conversational answer (ungated);
    // a work request gets the planned, gated workflow. Mode "plan"/"auto" are
    // operator directives for execution, so those always run as tasks.
    if (mode === "accept-edits" && classifyIntent(body) === "chat") {
      await runChat(body);
      return;
    }

    const envelope = buildEarnPromptEnvelope({ body, model, mode, attachments, voiceUsed });
    setBusy(true);
    setPlanning(true);
    setOpenMenu(null);
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

  // Stream a conversational answer from Earn into the transcript, token by
  // token. Ungated and client-side — no workflow, no approval, just an answer.
  async function runChat(body: string) {
    setBusy(true);
    setOpenMenu(null);
    setPrompt("");
    setAttachments([]);
    setVoiceUsed(false);

    const youId = `you-${Date.now()}`;
    const earnId = `earn-${Date.now()}`;
    const prior = chatTurns.filter((t) => t.role === "you").map((t) => t.content);
    setChatTurns((prev) => [
      ...prev,
      { id: youId, role: "you", content: body },
      { id: earnId, role: "earn", content: "", streaming: true },
    ]);

    const append = (chunk: string) =>
      setChatTurns((prev) =>
        prev.map((t) => (t.id === earnId ? { ...t, content: t.content + chunk } : t)),
      );

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionId ? { body, model, prior, session_id: sessionId } : { body, model, prior }),
      });
      if (!res.ok || !res.body) throw new Error("chat failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        append(decoder.decode(value, { stream: true }));
      }
    } catch {
      setChatTurns((prev) =>
        prev.map((t) =>
          t.id === earnId
            ? { ...t, content: t.content || "Earn couldn't reach the model — try again." }
            : t,
        ),
      );
    } finally {
      setChatTurns((prev) =>
        prev.map((t) => (t.id === earnId ? { ...t, streaming: false } : t)),
      );
      setBusy(false);
    }
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
  const empty = turns.length === 0 && chatTurns.length === 0 && !planning;

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setAttachments((prev) => [
      ...prev,
      ...Array.from(files)
        .filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"))
        .map((file) => ({ name: file.name, type: file.type, size: file.size })),
    ].slice(0, 6));
  }

  // Microphone is hold-to-record: recording starts on pointer-down and the
  // transcript lands when the operator releases (or the recognizer ends).
  function startVoice() {
    if (recognitionRef.current) return;
    type SpeechRecognitionLike = {
      lang: string;
      interimResults: boolean;
      onstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      start: () => void;
      stop: () => void;
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
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };
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
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
  }

  // "/Slash command" — drop the chosen scaffold into the input and focus so the
  // operator can complete the specifics.
  function applySlashCommand(template: string) {
    setPrompt((p) => (p.trim() ? `${p.trimEnd()} ${template}` : template));
    setOpenMenu(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }

  // Integration capability — drop an operational instruction naming the channel
  // and action into the composer. Earn plans it and it runs through the usual
  // approval-gated dispatch (the operator completes the target and sends).
  function applyIntegrationAction(integrationLabel: string, capabilityLabel: string) {
    const scaffold = `Use ${integrationLabel} to ${capabilityLabel.toLowerCase()} `;
    setExpandedIntegration(null);
    applySlashCommand(scaffold);
  }

  return (
    <div className="fx-neural-ambient mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl flex-col">
      <section className="relative flex min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-line/80 bg-surface-0/88 shadow-[0_24px_90px_-58px_rgb(var(--fx-accent-rgb)/0.9)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(var(--fx-accent-rgb)/0.16),transparent_36%),linear-gradient(rgb(var(--fx-accent-rgb)/0.045)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--fx-accent-rgb)/0.045)_1px,transparent_1px)] bg-[length:auto,32px_32px,32px_32px]"
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
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

              {/* Conversational answers — Earn's chat path, streamed in. */}
              {chatTurns.map((t) =>
                t.role === "you" ? (
                  <div key={t.id} className="flex justify-end gap-3">
                    <div className="max-w-[84%]">
                      <div className="mb-1 flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        You
                      </div>
                      <div className="whitespace-pre-wrap rounded-2xl rounded-br-md border border-line/70 bg-surface-2/80 px-4 py-3 text-sm leading-6 text-fg-primary shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
                        {t.content}
                      </div>
                    </div>
                    <span className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-1 font-mono text-[10px] font-semibold text-gold-300">
                      YOU
                    </span>
                  </div>
                ) : (
                  <div key={t.id} className="flex gap-3">
                    <EarnOrb size={32} pulse={t.streaming} className="mt-5" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        Earn
                        <span className="h-1 w-1 rounded-full bg-line" />
                        <span>{t.streaming ? "Answering" : "Answer"}</span>
                      </div>
                      <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line/80 bg-surface-1/82 px-4 py-3 text-sm leading-6 text-fg-primary shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
                        {t.content}
                        {t.streaming ? (
                          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-gold-400 align-text-bottom" aria-hidden />
                        ) : null}
                      </div>
                    </div>
                  </div>
                ),
              )}

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
                onChange={(e) => setPrompt(e.target.value)}
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

              {/* Hidden picker the "+" menu drives — keeps file selection out of
                  the toolbar while staying one tap away. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.currentTarget.value = "";
                }}
              />

              <div
                ref={toolbarRef}
                className="flex flex-wrap items-center gap-2 border-t border-line/70 px-1 pt-2"
              >
                {/* Model picker — "LLM models: <model> (Default)". */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenMenu((m) => (m === "model" ? null : "model"))}
                    aria-haspopup="menu"
                    aria-expanded={openMenu === "model"}
                    className="flex h-8 max-w-[15rem] items-center gap-1.5 rounded-lg border border-line bg-surface-0/80 px-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-secondary transition hover:border-gold-500/45 hover:text-fg-primary"
                    title="Reasoning model"
                  >
                    <span aria-hidden className="text-fg-muted">▾</span>
                    <span className="truncate">
                      LLM models: {activeModel.label}
                      {activeModel.default ? " (Default)" : ""}
                    </span>
                  </button>
                  {openMenu === "model" ? (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 z-20 mb-2 w-60 overflow-hidden rounded-xl border border-line/85 bg-surface-1/95 p-1 shadow-[0_24px_60px_-32px_rgb(0_0_0/0.8)] backdrop-blur-xl"
                    >
                      <p className="px-2.5 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Models</p>
                      {EARN_MODELS.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={m.key === model}
                          onClick={() => {
                            setModel(m.key);
                            setOpenMenu(null);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface-2 ${
                            m.key === model ? "text-fg-primary" : "text-fg-secondary"
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="flex items-center gap-1.5">
                              {m.label}
                              {m.default ? (
                                <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-gold-300">
                                  Default
                                </span>
                              ) : null}
                            </span>
                            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{m.provider}</span>
                          </span>
                          {m.key === model ? <span className="text-gold-300" aria-hidden>✓</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Mode selector — Accept edits / Plan Mode / Auto Mode. */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenMenu((m) => (m === "mode" ? null : "mode"))}
                    aria-haspopup="menu"
                    aria-expanded={openMenu === "mode"}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-0/80 px-2.5 text-xs text-fg-secondary transition hover:border-gold-500/45 hover:text-fg-primary"
                    title="Operator mode"
                  >
                    <span aria-hidden className="text-fg-muted">▾</span>
                    {activeMode.label}
                  </button>
                  {openMenu === "mode" ? (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-xl border border-line/85 bg-surface-1/95 p-1 shadow-[0_24px_60px_-32px_rgb(0_0_0/0.8)] backdrop-blur-xl"
                    >
                      <p className="px-2.5 pb-1 pt-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Mode</p>
                      {EARN_MODES.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={m.key === mode}
                          onClick={() => {
                            setMode(m.key);
                            setOpenMenu(null);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-2 ${
                            m.key === mode ? "text-fg-primary" : "text-fg-secondary"
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="text-sm">{m.label}</span>
                            <span className="text-[10px] text-fg-muted">{m.hint}</span>
                          </span>
                          {m.key === mode ? <span className="text-gold-300" aria-hidden>✓</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* "+" menu — Add files or photos · /Slash command · Integrations. */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenMenu((m) =>
                        m === "plus" || m === "slash" || m === "integrations" ? null : "plus",
                      )
                    }
                    aria-haspopup="menu"
                    aria-expanded={openMenu === "plus" || openMenu === "slash" || openMenu === "integrations"}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-0/80 text-base text-fg-secondary transition hover:border-gold-500/45 hover:text-fg-primary"
                    title="Add files, slash commands, or integrations"
                  >
                    <span aria-hidden className="font-mono">+</span>
                    <span className="sr-only">Add</span>
                  </button>
                  {openMenu === "plus" ? (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-xl border border-line/85 bg-surface-1/95 p-1 shadow-[0_24px_60px_-32px_rgb(0_0_0/0.8)] backdrop-blur-xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          fileInputRef.current?.click();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                      >
                        <span aria-hidden className="font-mono text-fg-muted">▣</span>
                        Add files or photos
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setOpenMenu("slash")}
                        className="flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                      >
                        <span className="flex items-center gap-2.5">
                          <span aria-hidden className="font-mono text-fg-muted">/</span>
                          Slash command
                        </span>
                        <span aria-hidden className="text-fg-muted">›</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setOpenMenu("integrations")}
                        className="flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                      >
                        <span className="flex items-center gap-2.5">
                          <span aria-hidden className="font-mono text-fg-muted">⤬</span>
                          Integrations
                        </span>
                        <span className="flex items-center gap-1.5">
                          {integrations.length ? (
                            <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] text-status-success">
                              {integrations.length}
                            </span>
                          ) : null}
                          <span aria-hidden className="text-fg-muted">›</span>
                        </span>
                      </button>
                    </div>
                  ) : null}
                  {openMenu === "integrations" ? (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-line/85 bg-surface-1/95 p-1 shadow-[0_24px_60px_-32px_rgb(0_0_0/0.8)] backdrop-blur-xl"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedIntegration(null);
                          setOpenMenu("plus");
                        }}
                        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
                      >
                        <span aria-hidden>‹</span> Active integrations
                      </button>
                      {integrations.length ? (
                        integrations.map((it) => {
                          const expanded = expandedIntegration === it.channel;
                          const hasActions = it.capabilities.length > 0;
                          return (
                            <div key={it.channel}>
                              <button
                                type="button"
                                disabled={!hasActions}
                                aria-expanded={expanded}
                                onClick={() =>
                                  setExpandedIntegration((c) => (c === it.channel ? null : it.channel))
                                }
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg-primary transition hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
                              >
                                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-status-success" />
                                <span className="flex-1 truncate">{it.label}</span>
                                {hasActions ? (
                                  <span className="font-mono text-[9px] text-fg-muted">
                                    {it.capabilities.length} action{it.capabilities.length === 1 ? "" : "s"}
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                                    Connected
                                  </span>
                                )}
                                {hasActions ? (
                                  <span aria-hidden className="text-fg-muted">{expanded ? "▾" : "▸"}</span>
                                ) : null}
                              </button>
                              {expanded && hasActions ? (
                                <div className="mb-1 ml-4 flex flex-col gap-0.5 border-l border-line/70 pl-2">
                                  {it.capabilities.map((cap) => (
                                    <button
                                      key={cap.kind}
                                      type="button"
                                      onClick={() => applyIntegrationAction(it.label, cap.label)}
                                      title={`${cap.tierLabel} action — runs through Earn's approval gate`}
                                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                                    >
                                      <span className="truncate">{cap.label}</span>
                                      <span
                                        className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider ${
                                          cap.tier === 3
                                            ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
                                            : cap.tier === 2
                                              ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
                                              : "border-line bg-surface-0 text-fg-muted"
                                        }`}
                                      >
                                        {cap.tierLabel}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <p className="px-2.5 py-3 text-xs leading-snug text-fg-secondary">
                          No integrations connected yet. Connect Gmail, Docusign, Slack, and more to let
                          Earn act on your behalf.
                        </p>
                      )}
                      <a
                        href="/settings#integrations"
                        onClick={() => setOpenMenu(null)}
                        className="mt-1 flex w-full items-center gap-2.5 border-t border-line/70 px-2.5 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                      >
                        <span aria-hidden className="font-mono text-fg-muted">⚙</span>
                        Manage integrations
                      </a>
                    </div>
                  ) : null}
                  {openMenu === "slash" ? (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-line/85 bg-surface-1/95 p-1 shadow-[0_24px_60px_-32px_rgb(0_0_0/0.8)] backdrop-blur-xl"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenMenu("plus")}
                        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
                      >
                        <span aria-hidden>‹</span> Slash commands
                      </button>
                      {SLASH_COMMANDS.map((c) => (
                        <button
                          key={c.command}
                          type="button"
                          role="menuitem"
                          onClick={() => applySlashCommand(c.template)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                        >
                          {c.label}
                          <span className="font-mono text-[10px] text-fg-muted">{c.command}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Microphone — hold to record. */}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    startVoice();
                  }}
                  onPointerUp={stopVoice}
                  onPointerLeave={stopVoice}
                  className={`flex h-8 w-8 select-none items-center justify-center rounded-lg border text-base transition ${
                    listening
                      ? "border-status-danger/50 bg-status-danger/10 text-status-danger"
                      : "border-line bg-surface-0/80 text-fg-secondary hover:border-gold-500/45 hover:text-fg-primary"
                  }`}
                  title="Hold to record"
                  aria-label="Hold to record"
                >
                  <span aria-hidden>{listening ? "●" : "🎙"}</span>
                </button>

                <span className="ml-auto hidden font-mono text-[10px] text-fg-muted sm:inline">
                  {listening ? "Recording — release to send" : "Enter to send · Shift+Enter for newline"}
                </span>
                <button
                  disabled={busy || !prompt.trim()}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-gold-400 px-3 text-xs font-semibold text-surface-0 shadow-[0_0_18px_rgb(var(--fx-accent-rgb)/0.24)] transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {planning ? "Planning" : sessionId ? "Send" : "Run"}
                  <span aria-hidden>↵</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </div>
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
  // Intelligence Layer: recompute the routing the same way the engine did, so
  // the card renders the Cursor-style Summary / Action / Output / Next Step.
  const routing = deriveRouting({
    prompt: workflow.description || workflow.title,
    hub: workflow.hub,
    agents: bundle.steps.map((s) => s.assigned_agent),
  });
  const cursor = cursorResponse(routing, { pending: Boolean(pending), stepCount: bundle.steps.length });
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

      {/* Routing badge — where the Intelligence Layer sent the work. */}
      <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-gold-500/30 bg-gold-500/[0.06] px-2.5 py-1">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" />
        <span className="truncate font-mono text-[10px] uppercase tracking-wider text-gold-300">
          {routingHeadline(routing)}
        </span>
      </div>

      {/* Cursor-style response: Summary / Action / Output / Next Step. */}
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Summary</dt>
          <dd className="text-fg-secondary">{cursor.summary}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Action</dt>
          <dd className="text-fg-secondary">{cursor.action}</dd>
        </div>
      </dl>

      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Output</p>
      <div className="mt-1.5 rounded-2xl border border-line/65 bg-surface-0/35 p-2.5">
        <WorkflowSteps bundle={bundle} />
      </div>

      <p className="mt-3 text-xs text-fg-secondary">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Next step</span>
        {" · "}
        {cursor.nextStep}
      </p>

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
