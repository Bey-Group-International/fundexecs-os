"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Task, Approval, Artifact } from "@/lib/supabase/database.types";
import type { SealStatus } from "@/lib/attestation-seal";
import { ArtifactInline, ARTIFACT_LABEL } from "@/components/ArtifactViewer";
import { routingFromTask, cursorResponse, EXECUTIVE_LABEL, EXECUTIVES, type TargetEngine, type Executive } from "@/lib/intelligence";
import { splitPositions, type SplitPosition } from "@/lib/split-grouping";
import { buildOutcome } from "@/lib/routing-trace";
import { RoutingTrace } from "@/components/RoutingTrace";
import { OutcomeReceipt } from "@/components/OutcomeReceipt";
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
import type { AgentPlan } from "@/lib/claude";
import { classifyIntent } from "@/lib/intent";
import { Markdown } from "@/components/Markdown";
import { ModelCompare, type ModelComparison } from "@/components/ModelCompare";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { RoutePanel } from "@/components/RoutePanel";

// A conversational turn rendered in the transcript. Chat turns are Earn's
// answer path (ungated) and live in client state alongside the workflow turns.
interface ChatTurn {
  id: string;
  role: "you" | "earn";
  content: string;
  // Creation time, so chat and workflow turns interleave by order in the rail.
  ts: number;
  streaming?: boolean;
  // For an Earn turn: the question that produced it (drives Regenerate) and the
  // suggested next prompts.
  sourcePrompt?: string;
  followups?: string[];
  // "Compare models": the same source question rerun across every EARN_MODELS
  // entry, filled in client-side. Display-only — nothing here is persisted.
  comparisons?: ModelComparison[];
}

// localStorage key for the remembered split ratio.

// Strip internal operator annotations that were prepended to prompts for routing
// purposes. These must never surface in the investor-facing conversation view.
function stripSystemAnnotations(content: string): string {
  return content
    .replace(/\[Selected reasoning engine:[^\]]*\]\s*/g, "")
    .replace(/\[Operator mode:[^\]]*\]\s*/g, "")
    .replace(/\[Voice input:[^\]]*\]\s*/g, "")
    .trim();
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

// An artifact carrying its optional tamper-evidence verdict. The seal is
// recomputed server-side on load (lib/artifact-seal.ts); undefined means
// "unsealed / not checked" and renders nothing.
export type SealedArtifact = Artifact & { seal_status?: SealStatus };

export interface WorkflowBundle {
  workflow: Task;
  steps: Task[];
  artifacts: SealedArtifact[];
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
        <span className="absolute h-5 w-5 animate-pulse rounded-full opacity-40 motion-reduce:animate-none" style={{ backgroundColor: color }} />
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
  // The id of the chat turn whose "Compare models" run is in flight, so its
  // button disables while the side-by-side fills in.
  const [comparingTurnId, setComparingTurnId] = useState<string | null>(null);
  // The most recent OTHER session's id — passed to /api/chat so the server can
  // load and summarise it as cross-session context.
  const [priorSessionId, setPriorSessionId] = useState<string | null>(null);
  // The plan streamed into the canvas while a task is being drafted, before the
  // real (gated) workflow lands.
  const [pendingPlan, setPendingPlan] = useState<AgentPlan | null>(null);
  // ⌘K command palette.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [clarifying, setClarifying] = useState(false);
  const [clarify, setClarify] = useState<{ workflowId: string; questions: string[]; answer: string } | null>(null);
  // Live step execution streamed from /api/approve/stream after an "approved"
  // decision: which steps are in-flight vs. completed, so the canvas lights them
  // up as they execute rather than waiting on the debounce refresh. Keyed by
  // step id; cleared once the workflow finishes and the refresh lands.
  const [liveSteps, setLiveSteps] = useState<Record<string, "in_progress" | "completed">>({});
  // Execution Grid: filter the conversation's workflows by the engine they were
  // routed to. null = show all.
  const [engineFilter, setEngineFilter] = useState<TargetEngine | null>(null);
  // Delegate & Route: the desk the operator has chosen to route the NEXT prompt
  // to, overriding Earn's auto-routing. null = let Earn route (the default).
  const [delegate, setDelegate] = useState<Executive | null>(null);
  // Ephemeral confirmations (decision receipts, re-routes) — bottom-right toasts.
  const [toasts, setToasts] = useState<{ id: string; msg: string; tone: "ok" | "warn" }[]>([]);
  // Which composer popover is open: the model picker, mode picker, "+" menu, or
  // one of its submenus (slash commands / active integrations).
  const [openMenu, setOpenMenu] = useState<"model" | "mode" | "route" | "plus" | "slash" | "integrations" | null>(null);
  // The response actions menu currently open in the transcript.
  const [responseMenuId, setResponseMenuId] = useState<string | null>(null);
  // Which integration row in the submenu is expanded to reveal its operational
  // actions.
  const [expandedIntegration, setExpandedIntegration] = useState<string | null>(null);
  // Which workflow the work canvas shows.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [, startTransition] = useTransition();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  // In-flight chat stream, so the Stop control can abort it.
  const chatAbortRef = useRef<AbortController | null>(null);
  // Pending toast dismissal timers, cleared on unmount.
  const toastTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = toastTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Load persisted chat turns for this session on mount so answers survive a
  // reload even when initialChat is stale (e.g. edge-cached page).
  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    supabase
      .from("session_messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          const loaded: ChatTurn[] = [];
          data.forEach((m, i) => {
            const ts = new Date(m.created_at as string).getTime() || Date.now() + i;
            loaded.push({
              id: `loaded-${i}`,
              role: m.role === "assistant" ? "earn" : "you",
              content: m.content as string,
              ts,
            });
          });
          // Only override if we got more turns than the SSR seed.
          setChatTurns((prev) => (loaded.length > prev.length ? loaded : prev));
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fetch the most recent OTHER session so the API route can load its messages
  // as cross-session context.
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();
    const query = supabase
      .from("sessions")
      .select("id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(5);
    query.then(({ data }) => {
      if (!data) return;
      const other = data.find((s) => s.id !== sessionId);
      if (other) setPriorSessionId(other.id as string);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, sessionId]);

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

  // Response action menus behave like product menus: click away or Escape closes.
  useEffect(() => {
    if (!responseMenuId) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-response-menu]")) setResponseMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setResponseMenuId(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [responseMenuId]);


  // Global shortcuts: ⌘K/Ctrl+K opens the command palette; Esc stops an
  // in-progress answer (when no menu/palette is capturing it).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && !paletteOpen && !openMenu && chatAbortRef.current) {
        stopChat();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, openMenu]);

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
    await dispatchPrompt(prompt.trim());
  }

  // Route a prompt: a question gets a conversational answer (ungated); a work
  // request gets the planned, gated workflow. Mode "plan"/"auto" are operator
  // directives for execution, so those always run as tasks.
  async function dispatchPrompt(body: string) {
    if (!body || busy) return;
    // An explicit desk delegation means the operator wants work done, not a
    // chat answer — so it always takes the agentic (gated) task path.
    if (!delegate && mode === "accept-edits" && classifyIntent(body) === "chat") {
      await runChat(body);
    } else {
      if (delegate) pushToast(`Routing to ${EXECUTIVE_LABEL[delegate]}`);
      await runTask(body);
    }
    // Return focus to the composer so the operator can keep typing without a
    // mouse — the input may have lost focus when a control was tapped to send.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Non-streaming fallback (and the path when the live stream errors): plan +
  // materialize in one shot, then follow into the session or refresh in place.
  async function runTaskFallback(envelope: string) {
    const res = await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: envelope,
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(delegate ? { delegate } : {}),
      }),
    }).catch(() => null);
    setBusy(false);
    setPlanning(false);
    setPendingPlan(null);
    if (!sessionId && res?.ok) {
      const data = await res.json().catch(() => null);
      if (data?.session_id) {
        router.push(`/session/${data.session_id}`);
        return;
      }
    }
    startTransition(() => router.refresh());
  }

  // Launch the agentic workflow path (plan → gate → dispatch). The plan streams
  // into the work canvas as Earn drafts it; on ready we hand off to the live
  // (gated) workflow.
  async function runTask(body: string) {
    const envelope = buildEarnPromptEnvelope({ body, model, mode, attachments, voiceUsed });
    setBusy(true);
    setPlanning(true);
    setOpenMenu(null);
    setPrompt("");
    setAttachments([]);
    setVoiceUsed(false);
    setPendingPlan(null);

    try {
      const res = await fetch("/api/prompt/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: envelope,
          ...(sessionId ? { session_id: sessionId } : {}),
          ...(delegate ? { delegate } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error("stream unavailable");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let ready: { session_id?: string; workflow_id?: string } | null = null;
      let errored = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; plan?: AgentPlan; session_id?: string; workflow_id?: string };
          if (ev.type === "plan" && ev.plan) setPendingPlan(ev.plan);
          else if (ev.type === "ready") ready = ev;
          else if (ev.type === "error") errored = true;
        }
      }
      if (errored || !ready) throw new Error("plan failed");

      setBusy(false);
      setPlanning(false);
      if (!sessionId && ready.session_id) {
        router.push(`/session/${ready.session_id}`);
        return;
      }
      setPendingPlan(null);
      startTransition(() => router.refresh());
    } catch {
      await runTaskFallback(envelope);
    }
  }

  // Stream a conversational answer from Earn into the transcript, token by
  // token. Ungated and client-side — no workflow, no approval, just an answer.
  async function runChat(body: string) {
    setBusy(true);
    setOpenMenu(null);
    setPrompt("");
    setAttachments([]);
    setVoiceUsed(false);

    const now = Date.now();
    const youId = `you-${now}`;
    const earnId = `earn-${now}`;
    // Full session history threaded as role/content pairs (capped at 30 to stay
    // within context limits). The API route appends this as conversation history.
    const prior = chatTurns.slice(-30).map((t) => ({
      role: t.role === "you" ? ("user" as const) : ("assistant" as const),
      content: t.content,
    }));
    setChatTurns((prev) => [
      ...prev,
      { id: youId, role: "you", content: body, ts: now },
      { id: earnId, role: "earn", content: "", ts: now + 1, streaming: true, sourcePrompt: body },
    ]);

    const append = (chunk: string) =>
      setChatTurns((prev) =>
        prev.map((t) => (t.id === earnId ? { ...t, content: t.content + chunk } : t)),
      );

    const controller = new AbortController();
    chatAbortRef.current = controller;
    let replyText = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          model,
          prior,
          ...(sessionId ? { session_id: sessionId } : {}),
          ...(priorSessionId ? { prior_session_id: priorSessionId } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("chat failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        replyText += chunk;
        append(chunk);
      }
    } catch (err) {
      // An operator-initiated Stop aborts the reader — keep the partial answer.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setChatTurns((prev) =>
          prev.map((t) =>
            t.id === earnId
              ? { ...t, content: t.content || "Earn couldn't reach the model — try again." }
              : t,
          ),
        );
      }
    } finally {
      chatAbortRef.current = null;
      setChatTurns((prev) => prev.map((t) => (t.id === earnId ? { ...t, streaming: false } : t)));
      setBusy(false);
    }

    // Suggested follow-ups under the answer — best-effort, after it completes.
    if (replyText.trim()) {
      const suggestions = await fetch("/api/chat/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, reply: replyText }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (Array.isArray(d?.suggestions) ? (d.suggestions as string[]) : []))
        .catch(() => []);
      if (suggestions.length) {
        setChatTurns((prev) => prev.map((t) => (t.id === earnId ? { ...t, followups: suggestions } : t)));
      }
    }
  }

  // Stop an in-progress answer; the partial text is kept.
  function stopChat() {
    chatAbortRef.current?.abort();
  }

  // "Compare models": rerun the turn's SAME source question across every model
  // in EARN_MODELS and fill the per-model cards. Ungated and client-side — each
  // request omits session_id so nothing persists.
  async function compareModels(turnId: string, sourcePrompt: string) {
    if (comparingTurnId) return;
    setComparingTurnId(turnId);
    const seeded: ModelComparison[] = EARN_MODELS.map((m) => ({
      model: m.key,
      label: m.label,
      content: "",
      loading: true,
    }));
    setChatTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, comparisons: seeded } : t)));

    const setCard = (model: EarnModelKey, patch: Partial<ModelComparison>) =>
      setChatTurns((prev) =>
        prev.map((t) =>
          t.id === turnId && t.comparisons
            ? { ...t, comparisons: t.comparisons.map((c) => (c.model === model ? { ...c, ...patch } : c)) }
            : t,
        ),
      );

    await Promise.all(
      EARN_MODELS.map(async (m) => {
        let text = "";
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: sourcePrompt, model: m.key }),
          });
          if (!res.ok || !res.body) throw new Error("compare failed");
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
            setCard(m.key, { content: text });
          }
        } catch {
          if (!text) text = "Earn couldn't reach this model — try again.";
        } finally {
          setCard(m.key, { content: text, loading: false });
        }
      }),
    );

    setComparingTurnId(null);
  }

  function copyText(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  // Surface a transient confirmation so the operator knows an action landed.
  // Timers are tracked so they can be cleared if the component unmounts first.
  function pushToast(msg: string, tone: "ok" | "warn" = "ok") {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, msg, tone }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimers.current.delete(timer);
    }, 4200);
    toastTimers.current.add(timer);
  }

  // Non-streaming approval (every decision but the live-streamed "approved"
  // path, and the fallback when the stream is unavailable).
  async function decidePlain(
    approvalId: string,
    decision: "approved" | "rejected" | "regenerate" | "accepted",
    note?: string,
    desk?: Executive,
  ) {
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, decision, note, ...(desk ? { delegate: desk } : {}) }),
    }).catch(() => {});
    setClarify(null);
    setBusy(false);
    setLiveSteps({});
    startTransition(() => router.refresh());
  }

  // Approve & automate, with live step progress streamed into the canvas. Reads
  // the ndjson from /api/approve/stream and lights up steps as they execute,
  // then refreshes on workflow_done. Degrades gracefully: any stream failure
  // falls back to the plain /api/approve call so the gate still resolves.
  async function decideApproved(approvalId: string, note?: string) {
    setLiveSteps({});
    try {
      const res = await fetch("/api/approve/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approvalId, decision: "approved", note }),
      });
      if (!res.ok || !res.body) throw new Error("stream unavailable");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let errored = false;
      let done = false;
      for (;;) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as {
            type: string;
            step_id?: string;
          };
          if (ev.type === "step_start" && ev.step_id) {
            setLiveSteps((prev) => ({ ...prev, [ev.step_id as string]: "in_progress" }));
          } else if (ev.type === "step_done" && ev.step_id) {
            setLiveSteps((prev) => ({ ...prev, [ev.step_id as string]: "completed" }));
          } else if (ev.type === "workflow_done") {
            done = true;
          } else if (ev.type === "error") {
            errored = true;
          }
        }
      }
      if (errored || !done) throw new Error("approval stream failed");
      setClarify(null);
      setBusy(false);
      startTransition(() => router.refresh());
    } catch {
      // The work already runs server-side through the gate; fall back so the
      // operator still gets the result even if live progress dropped.
      await decidePlain(approvalId, "approved", note);
    }
  }

  async function decide(
    approvalId: string,
    decision: "approved" | "rejected" | "regenerate" | "accepted",
    note?: string,
    desk?: Executive,
  ) {
    setBusy(true);
    if (decision === "approved") {
      await decideApproved(approvalId, note);
    } else {
      await decidePlain(approvalId, decision, note, desk);
    }
    // Confirm the decision landed — the operator shouldn't have to guess.
    const receipt: Record<typeof decision, { msg: string; tone: "ok" | "warn" }> = {
      approved: { msg: "✓ Approved & automated", tone: "ok" },
      accepted: { msg: "✓ Accepted as recommendation", tone: "ok" },
      rejected: { msg: "Plan declined", tone: "warn" },
      regenerate: { msg: desk ? `Re-routed to ${EXECUTIVE_LABEL[desk]}` : "Refining the plan…", tone: "ok" },
    };
    const r = receipt[decision];
    pushToast(r.msg, r.tone);
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

  // Execution Grid: the engine each workflow was routed to (persisted, with a
  // deterministic fallback for older rows).
  const engineOf = (b: WorkflowBundle): TargetEngine =>
    routingFromTask({
      prompt: b.workflow.description || b.workflow.title,
      hub: b.workflow.hub,
      agents: b.steps.map((s) => s.assigned_agent),
      stage: b.workflow.lifecycle_stage,
    }).target_engine;

  // Split prompts: when the Intelligence Layer fans one prompt out into several
  // sibling workflows, they share a non-null prompt_id. Map each such workflow
  // to its "N of M" position so the card/rail can flag the split. Singletons and
  // null prompt_ids get no entry (and thus no chip).
  const splitOf = splitPositions(bundles.map((b) => b.workflow));

  // Engines present across the conversation — drives the filter chips.
  const enginesPresent = Array.from(new Set(bundles.map(engineOf)));
  const visibleBundles = engineFilter ? bundles.filter((b) => engineOf(b) === engineFilter) : bundles;

  // Conversation order: oldest turn first, newest nearest the composer.
  const turns = [...visibleBundles].reverse();
  const empty = bundles.length === 0 && chatTurns.length === 0 && !planning;

  // One time-ordered transcript of chat turns and workflow turns, by time.
  type RailItem =
    | { kind: "chat"; ts: number; turn: ChatTurn }
    | { kind: "work"; ts: number; bundle: WorkflowBundle };
  const rail: RailItem[] = [
    ...turns.map((b) => ({ kind: "work" as const, ts: Date.parse(b.workflow.created_at) || 0, bundle: b })),
    ...chatTurns.map((t) => ({ kind: "chat" as const, ts: t.ts, turn: t })),
  ].sort((a, b) => a.ts - b.ts);

  // A chat turn in the conversation rail. Earn reads as an institutional answer,
  // not a widget: the response is primary; controls stay quiet and secondary.
  function renderChatTurn(t: ChatTurn) {
    if (t.role === "you") {
      return (
        <div key={t.id} className="flex justify-end gap-3">
          <div className="max-w-[84%]">
            <div className="mb-1 flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              You
            </div>
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-line/70 bg-surface-2/80 px-4 py-3 text-sm leading-6 text-fg-primary shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
              {stripSystemAnnotations(t.content)}
            </div>
          </div>
          <span className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-1 font-mono text-[10px] font-semibold text-gold-300">
            YOU
          </span>
        </div>
      );
    }
    const primaryFollowups = t.followups?.slice(0, 2) ?? [];

    return (
      <div key={t.id} className="flex gap-3">
        <EarnOrb size={24} pulse={t.streaming} className="mt-1.5" />
        <div className="min-w-0 flex-1 border-l border-gold-500/25 pl-4">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
            <span className="text-gold-300">Earn</span>
            <span className="h-1 w-1 rounded-full bg-line" />
            <span>{t.streaming ? "Drafting response" : "Private-market response"}</span>
          </div>
          <div
            className="max-w-none text-sm leading-6 text-fg-primary"
            aria-live="polite"
            aria-busy={t.streaming}
          >
            {t.content ? <Markdown>{t.content}</Markdown> : null}
            {t.streaming ? (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-gold-400 align-text-bottom motion-reduce:animate-none" aria-hidden />
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line/60 pt-2">
            {t.streaming ? (
              <button
                type="button"
                onClick={stopChat}
                className="font-mono text-[10px] uppercase tracking-wider text-status-danger/80 transition hover:text-status-danger"
              >
                Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => copyText(t.content)}
                  disabled={!t.content}
                  className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary disabled:opacity-40"
                >
                  Copy
                </button>
                {t.sourcePrompt ? (
                  <div className="relative" data-response-menu>
                    <button
                      type="button"
                      onClick={() => setResponseMenuId((id) => (id === t.id ? null : t.id))}
                      aria-haspopup="menu"
                      aria-expanded={responseMenuId === t.id}
                      className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary"
                    >
                      More
                    </button>
                    {responseMenuId === t.id ? (
                    <div className="absolute left-0 top-full z-20 mt-1.5 w-40 rounded-xl border border-line/80 bg-surface-1/95 p-1 shadow-[0_20px_48px_-28px_rgb(0_0_0/0.8)] backdrop-blur-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setResponseMenuId(null);
                          dispatchPrompt(t.sourcePrompt!);
                        }}
                        disabled={busy}
                        className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary disabled:opacity-40"
                      >
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResponseMenuId(null);
                          compareModels(t.id, t.sourcePrompt!);
                        }}
                        disabled={comparingTurnId !== null}
                        className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary disabled:opacity-40"
                      >
                        {comparingTurnId === t.id ? "Comparing..." : "Compare models"}
                      </button>
                    </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
            {primaryFollowups.length ? (
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  Continue
                </span>
                {primaryFollowups.map((s, i) => (
                  <button
                    key={`${t.id}-f${i}`}
                    type="button"
                    onClick={() => dispatchPrompt(s)}
                    disabled={busy}
                    className="max-w-[16rem] truncate rounded-full border border-line/70 px-2.5 py-1 text-xs text-fg-secondary transition hover:border-gold-500/50 hover:text-fg-primary disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {t.comparisons?.length ? <ModelCompare comparisons={t.comparisons} /> : null}
        </div>
      </div>
    );
  }

  // A workflow turn rendered inline in the conversation — the prompt bubble
  // followed by the full WorkflowCard (plan, steps, artifacts, approval gate).
  function renderWorkRef(b: WorkflowBundle) {
    const active = b.workflow.status === "in_progress" || b.workflow.status === "awaiting_approval";
    const split = splitOf.get(b.workflow.id) ?? null;
    return (
      <div key={b.workflow.id} className="flex flex-col gap-3">
        <div className="flex justify-end gap-3">
          <div className="max-w-[84%]">
            <div className="mb-1 flex items-center justify-end gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              You
            </div>
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-line/70 bg-surface-2/80 px-4 py-3 text-sm leading-6 text-fg-primary shadow-[0_1px_2px_rgb(0_0_0/0.2)]">
              {b.workflow.description || b.workflow.title}
            </div>
          </div>
          <span className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-1 font-mono text-[10px] font-semibold text-gold-300">
            YOU
          </span>
        </div>
        <div className="flex gap-3">
          <EarnOrb size={32} pulse={active} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <WorkflowCard
              bundle={b}
              busy={busy}
              decide={decide}
              liveSteps={liveSteps}
              split={split}
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
    );
  }

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

  // ⌘K command palette actions — models, modes, slash inserts, jump-to-workflow,
  // and navigation.
  const commands: Command[] = [
    ...EARN_MODELS.map((m) => ({
      id: `model-${m.key}`,
      group: "Model",
      label: `Use ${m.label}`,
      hint: m.key === model ? "current" : undefined,
      run: () => setModel(m.key),
    })),
    ...EARN_MODES.map((m) => ({
      id: `mode-${m.key}`,
      group: "Mode",
      label: m.label,
      hint: m.key === mode ? "current" : undefined,
      run: () => setMode(m.key),
    })),
    ...SLASH_COMMANDS.map((c) => ({
      id: `slash-${c.command}`,
      group: "Insert",
      label: c.label,
      hint: c.command,
      run: () => applySlashCommand(c.template),
    })),
    ...(chatAbortRef.current ? [{ id: "stop", group: "Action", label: "Stop generating", run: stopChat }] : []),
    { id: "integrations", group: "Go", label: "Manage integrations", run: () => router.push("/settings#integrations") },
    { id: "new", group: "Go", label: "New conversation", run: () => router.push("/workspace") },
  ];

  return (
    <div className="fx-neural-ambient mx-auto flex h-[calc(100dvh-8rem)] max-w-5xl flex-col">
      <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-line/80 bg-surface-0/88 shadow-[0_24px_90px_-58px_rgb(var(--fx-accent-rgb)/0.9)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgb(var(--fx-accent-rgb)/0.16),transparent_36%),linear-gradient(rgb(var(--fx-accent-rgb)/0.045)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--fx-accent-rgb)/0.045)_1px,transparent_1px)] bg-[length:auto,32px_32px,32px_32px]"
        />

        <div ref={splitRef} className="relative flex min-h-0 flex-1 flex-col">
          <div
            role="region"
            aria-label="Conversation"
            className="relative flex min-h-0 flex-col flex-1"
          >
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


              {/* Unified transcript: chat turns and compact workflow refs, by time. */}
              {rail.map((item) =>
                item.kind === "chat" ? renderChatTurn(item.turn) : renderWorkRef(item.bundle),
              )}

              {pendingPlan ? (
                <div className="flex gap-3">
                  <EarnOrb size={32} pulse className="mt-1.5" />
                  <article className="min-w-0 flex-1 rounded-2xl border border-gold-500/30 bg-surface-1/82 p-4 shadow-[0_0_36px_-28px_rgb(var(--fx-accent-rgb)/0.9)]">
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg font-semibold tracking-tight text-fg-primary">{pendingPlan.title}</h2>
                    </div>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      {pendingPlan.hub} · Drafting
                    </p>
                    {pendingPlan.summary ? <p className="mt-2 text-sm text-fg-secondary">{pendingPlan.summary}</p> : null}
                    <ol className="mt-3 flex flex-col gap-2">
                      {pendingPlan.steps.map((s, i) => (
                        <li
                          key={`${s.agent}-${i}`}
                          className="flex gap-3 rounded-xl border border-line/60 bg-surface-0/45 px-3 py-2.5"
                        >
                          <span className="mt-0.5 h-5 w-5 shrink-0 animate-pulse rounded-full border-2 border-gold-500/50 motion-reduce:animate-none" />
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-fg-primary">{s.title}</span>
                            <p className="mt-0.5 text-xs text-fg-secondary">
                              <span className="font-mono uppercase text-fg-muted">{AGENT_BY_KEY[s.agent]?.name ?? s.agent}</span>
                              {" · "}
                              {s.description}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-gold-300">Preparing the approval gate…</p>
                  </article>
                </div>
              ) : planning ? (
                <div className="flex gap-3">
                  <EarnOrb size={32} pulse className="mt-1" />
                  <div className="relative overflow-hidden rounded-2xl border border-gold-500/25 bg-surface-1/80 px-4 py-3 text-sm text-fg-secondary">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400 motion-reduce:animate-none" />
                      Reading your prompt and drafting the plan...
                    </span>
                    <span className="fx-data-stream motion-reduce:hidden" aria-hidden />
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </div>
          </div>


          {/* Composer — text-first by default; secondary actions live behind Tools. */}
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
                      aria-label={`Remove attachment ${file.name}`}
                    >
                      {file.type.startsWith("video/") ? "video" : "image"} · {file.name} x
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={prompt}
                  rows={1}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={sessionId ? "Reply to Earn..." : "Ask Earn what to move forward..."}
                  className="max-h-44 min-h-[46px] flex-1 resize-none rounded-xl border-0 bg-transparent px-3 py-3 text-sm leading-6 text-fg-primary outline-none placeholder:text-fg-muted"
                />
                <button
                  disabled={busy || !prompt.trim()}
                  className="mb-1 flex h-9 shrink-0 items-center rounded-lg bg-gold-400 px-3.5 text-xs font-semibold text-surface-0 shadow-[0_0_18px_rgb(var(--fx-accent-rgb)/0.24)] transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {planning ? "Planning" : "Send"}
                </button>
              </div>

              {/* Hidden picker the Tools menu drives — keeps file selection out of
                  the default composer while staying one tap away. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.currentTarget.value = "";
                  setOpenMenu(null);
                }}
              />

              <div ref={toolbarRef} className="mt-1 flex items-center justify-between gap-2 px-1">
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
                    className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
                    title="Open composer tools"
                  >
                    Tools
                    <span aria-hidden>{openMenu ? "▾" : "▸"}</span>
                  </button>
                  {openMenu === "plus" ? (
                    <div
                      role="menu"
                      className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-line/85 bg-surface-1/95 p-1 shadow-[0_24px_60px_-32px_rgb(0_0_0/0.8)] backdrop-blur-xl"
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
                        Attach file or photo
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          startVoice();
                        }}
                        onPointerUp={stopVoice}
                        onPointerLeave={stopVoice}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                          listening
                            ? "bg-status-danger/10 text-status-danger"
                            : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                        }`}
                      >
                        <span aria-hidden className="font-mono text-fg-muted">{listening ? "●" : "◉"}</span>
                        {listening ? "Release to stop voice input" : "Hold for voice input"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setOpenMenu("slash")}
                        className="flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                      >
                        <span className="flex items-center gap-2.5">
                          <span aria-hidden className="font-mono text-fg-muted">/</span>
                          Prompt shortcuts
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
                          <span aria-hidden className="font-mono text-fg-muted">⇆</span>
                          Connected actions
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
                <span className="hidden font-mono text-[10px] text-fg-muted sm:inline">
                  Enter to send · Shift+Enter for newline
                </span>
              </div>
            </div>
          </form>
        </div>
      </section>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />

      {/* Toast viewport — transient confirmations that an action landed. */}
      {toasts.length ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto rounded-xl border px-3.5 py-2.5 text-sm shadow-[0_24px_60px_-32px_rgb(0_0_0/0.8)] backdrop-blur-xl ${
                t.tone === "warn"
                  ? "border-status-danger/40 bg-surface-1/95 text-fg-primary"
                  : "border-gold-500/40 bg-surface-1/95 text-fg-primary"
              }`}
              role="status"
            >
              {t.msg}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Renders a step's plain-text deliverable (from step.result.output when there's
// no durable artifact) in a subtle pre block, truncated to ~6 lines with a
// "Show more" expand so the step card stays scannable by default.
function StepDeliverable({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const LINE_LIMIT = 6;
  const lines = text.split("\n");
  const truncated = !expanded && lines.length > LINE_LIMIT;
  const displayed = truncated ? lines.slice(0, LINE_LIMIT).join("\n") : text;
  return (
    <div className="mt-2 rounded-lg border border-line/60 bg-surface-0/50">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-5 text-fg-secondary">
        {displayed}
        {truncated ? "…" : ""}
      </pre>
      {lines.length > LINE_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-line/60 px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
        >
          {expanded ? "Show less ▴" : `Show more (${lines.length - LINE_LIMIT} more lines) ▾`}
        </button>
      ) : null}
    </div>
  );
}

function WorkflowSteps({
  bundle,
  liveSteps = {},
}: {
  bundle: WorkflowBundle;
  // Live step states streamed during an "approved" run, keyed by step id. Used
  // only to advance a step's display ahead of the debounce refresh — it never
  // regresses a persisted status or overrides a terminal one.
  liveSteps?: Record<string, "in_progress" | "completed">;
}) {
  const { steps, artifacts } = bundle;
  const artifactByStep = new Map<string, Artifact>();
  for (const a of artifacts) if (a.step_id) artifactByStep.set(a.step_id, a);
  return (
    <ol className="relative flex flex-col gap-2.5">
      {steps.map((step, i) => {
        const agent = AGENT_BY_KEY[step.assigned_agent];
        const artifact = artifactByStep.get(step.id);
        // Overlay live progress, but only to move a step forward: a persisted
        // completed/cancelled/failed step is never reopened by a stale event.
        const live = liveSteps[step.id];
        const status =
          step.status === "pending" && (live === "in_progress" || live === "completed")
            ? live
            : step.status === "in_progress" && live === "completed"
              ? "completed"
              : step.status;
        // Prefer the durable artifact; fall back to the step's inline result.
        const output =
          artifact?.content ??
          (step.result && typeof step.result === "object"
            ? (step.result as { output?: string }).output
            : undefined);
        return (
          <li key={step.id} className="flex gap-3 rounded-xl border border-line/60 bg-surface-0/45 px-3 py-2.5">
            <div className="flex flex-col items-center">
              <StepNode status={status} color={agent?.color} />
              {i < steps.length - 1 ? <span className="mt-1 w-px flex-1 bg-line/80" /> : null}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-fg-primary">{step.title}</span>
                {artifact ? (
                  <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                    {ARTIFACT_LABEL[artifact.artifact_type]}
                  </span>
                ) : null}
                <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {STATUS_LABEL[status] ?? status}
                </span>
              </div>
              <p className="mt-0.5 break-words text-xs text-fg-secondary">
                <span className="font-mono uppercase text-fg-muted">{agent?.name}</span> · {step.description}
              </p>
              {output ? (
                artifact ? (
                  // Durable artifact: render with full ArtifactInline (type-aware display).
                  <ArtifactInline content={output} artifactType={artifact.artifact_type} title={step.title} />
                ) : (
                  // Inline step result: plain-text deliverable with truncation + expand.
                  <StepDeliverable text={output} />
                )
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
  liveSteps,
  split,
  primary,
  clarifying,
  clarify,
  onAsk,
  onAnswerChange,
  onCancelClarify,
}: {
  bundle: WorkflowBundle;
  busy: boolean;
  decide: (id: string, d: "approved" | "rejected" | "regenerate" | "accepted", note?: string, desk?: Executive) => void;
  // Live step states streamed during this workflow's "approved" run.
  liveSteps?: Record<string, "in_progress" | "completed">;
  // This workflow's position within its split-prompt group, when it has siblings
  // (the engine fanned one prompt into several). null = not part of a split.
  split?: SplitPosition | null;
  primary?: boolean;
  clarifying: boolean;
  clarify: { questions: string[]; answer: string } | null;
  onAsk: () => void;
  onAnswerChange: (v: string) => void;
  onCancelClarify: () => void;
}) {
  const { workflow, approval } = bundle;
  const pending = approval && approval.decision === "pending";
  const decided = approval && approval.decision !== "pending";
  // Intelligence Layer: render the routing the engine PERSISTED on the workflow
  // (falling back to deterministic classification for pre-routing rows), so the
  // Cursor-style card never drifts from what was actually routed.
  const routing = routingFromTask({
    prompt: workflow.description || workflow.title,
    hub: workflow.hub,
    agents: bundle.steps.map((s) => s.assigned_agent),
    stage: workflow.lifecycle_stage,
  });
  const cursor = cursorResponse(routing, { pending: Boolean(pending), stepCount: bundle.steps.length });
  const outcome = buildOutcome(bundle);
  // Lead with the result: the workflow's primary deliverable (the first artifact
  // it produced) shown up top once work has run.
  const primaryArtifact = bundle.artifacts[0] ?? null;
  // Details (routing trace, summary/action, full step list) follow the workflow's
  // phase by default — open while a decision is pending or the run is live (so the
  // plan and streaming steps are visible), collapsed once the outcome leads — until
  // the operator toggles, after which their choice sticks.
  const livePhase = Boolean(pending) || workflow.status === "in_progress";
  const [detailsOverride, setDetailsOverride] = useState<boolean | null>(null);
  const detailsOpen = detailsOverride ?? livePhase;
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

      {/* Outcome receipt — durable proof a decision went through (when decided). */}
      {decided ? (
        <div className="mt-3">
          <OutcomeReceipt outcome={outcome} />
        </div>
      ) : null}

      {/* When this prompt was split into siblings, a "Split · N of M" chip. */}
      {split ? (
        <div className="mt-3 flex max-w-full flex-wrap items-center gap-2">
          <span
            className="inline-flex shrink-0 items-center rounded-full border border-gold-500/30 bg-gold-500/[0.06] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300"
            title="This workflow was split from one request into sibling workflows"
          >
            Split · {split.index} of {split.total}
          </span>
        </div>
      ) : null}

      {/* Lead with the result: the headline deliverable + the single next step. */}
      {!pending && primaryArtifact ? (
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Deliverable</p>
          <div className="mt-1.5 rounded-2xl border border-line/65 bg-surface-0/35 p-2.5">
            <ArtifactInline
              content={primaryArtifact.content}
              artifactType={primaryArtifact.artifact_type}
              title={primaryArtifact.title}
              sources={primaryArtifact.sources}
              verificationStatus={primaryArtifact.verification_status}
              groundingScore={primaryArtifact.grounding_score}
              sealStatus={primaryArtifact.seal_status}
            />
          </div>
          <p className="mt-2 text-xs text-fg-secondary">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Next step</span>
            {" · "}
            {cursor.nextStep}
          </p>
        </div>
      ) : null}

      {/* Layered detail — routing trace, summary/action, and the full step run
          fold behind a disclosure so the card stays scannable. */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setDetailsOverride(!detailsOpen)}
          aria-expanded={detailsOpen}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
        >
          <span className={`transition ${detailsOpen ? "rotate-90" : ""}`} aria-hidden>▸</span>
          {detailsOpen ? "Hide details" : pending ? "Plan & routing" : "Details & full run"}
        </button>

        {detailsOpen ? (
          <div className="mt-2 space-y-3">
            <RoutingTrace bundle={bundle} />

            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Summary</dt>
                <dd className="text-fg-secondary">{cursor.summary}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Action</dt>
                <dd className="text-fg-secondary">{cursor.action}</dd>
              </div>
            </dl>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Output</p>
              <div className="mt-1.5 rounded-2xl border border-line/65 bg-surface-0/35 p-2.5">
                <WorkflowSteps bundle={bundle} liveSteps={liveSteps} />
              </div>
            </div>
          </div>
        ) : null}
        {/* Unified Delegate & Route — change the engine or delegate to a desk in
            one place. Desk delegation re-plans, so it's only offered while pending. */}
        <RoutePanel
          workflowId={workflow.id}
          currentEngine={routing.target_engine}
          currentDesk={routing.assigned_to}
          canDelegate={Boolean(pending)}
          busy={busy}
          onDelegate={(d) => approval && decide(approval.id, "regenerate", undefined, d)}
        />
      </div>

      {pending ? (
        <div className="mt-4 border-t border-line/75 pt-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Your decision</p>
          <p className="mt-1 text-xs text-fg-secondary">{approval.summary}</p>

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

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(approval.id, "approved")}
                className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-surface-0 transition hover:bg-gold-300 disabled:opacity-50"
              >
                Approve &amp; automate
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(approval.id, "rejected")}
                className="rounded-lg border border-line/80 bg-surface-2/60 px-4 py-2 text-sm font-medium text-status-danger transition hover:bg-surface-3 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(approval.id, "accepted")}
                title="Accept the plan as the recommendation — agents won't run"
                className="text-fg-muted transition hover:text-gold-300 disabled:opacity-40"
              >
                Accept plan
              </button>
              <button
                type="button"
                disabled={busy || clarifying}
                onClick={onAsk}
                className="text-fg-muted transition hover:text-fg-secondary disabled:opacity-40"
              >
                {clarifying ? "Asking…" : "Ask"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(approval.id, "regenerate")}
                className="text-fg-muted transition hover:text-fg-secondary disabled:opacity-40"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
