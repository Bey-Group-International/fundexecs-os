"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { conversationFilename, threadToMarkdown } from "./conversation-export";
import type { ShareScope } from "@/lib/session-share";
import { AGENTS, AGENT_BY_KEY } from "@/lib/agents";
import { TIER_LABEL } from "@/lib/gates";
import {
  copilotContextFromPath,
  dockHiddenOn,
  onPointAgent,
  suggestionsFor,
  suggestionTier,
  willAutoRun,
} from "@/lib/copilot";
import {
  askEarn,
  deleteSessionTurn,
  editSessionTurn,
  launchCopilotSuggestion,
  shareEarnConversation,
  getConversationDealName,
  getCopilotBriefing,
  getMandateSummary,
  type CopilotBriefing,
} from "@/components/copilot/actions";
import { ReviewFeed } from "@/components/copilot/ReviewFeed";
import { TeamTasksFeed } from "@/components/copilot/TeamTasksFeed";
import { EarnOrb } from "@/components/copilot/EarnOrb";
import { Markdown } from "@/components/Markdown";
import { classifyIntent } from "@/lib/intent";
import {
  CONVERSATIONS_KEY,
  LEGACY_THREAD_KEY,
  conversationKeyForPath,
  conversationLabelForPath,
  findConversation,
  migrateLegacyThread,
  otherConversations,
  parseStore,
  removeConversation,
  upsertConversation,
  type ConversationStore,
} from "@/lib/copilot-conversations";
import type { Mandate } from "@/lib/gates";
import type { AgentKey } from "@/lib/supabase/database.types";

/** Turn a context slug ("deal_room") into a readable label ("Deal room"). */
function titleCase(slug: string): string {
  const words = slug.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

/** A small colored dot used to tag a message or chip with its agent's identity. */
function AgentDot({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />;
}

const TIER_TONE: Record<number, string> = {
  1: "border-status-success/40 text-status-success",
  2: "border-neural-400/45 text-neural-300",
  3: "border-status-danger/40 text-status-danger",
};

/** The first thing asked in a conversation — how a switcher row identifies it. */
function conversationPreview(thread: Turn[]): string {
  const first = thread.find((t) => t.role === "user");
  const text = first && first.role === "user" ? first.text : "";
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text || "No messages";
}

/** Stable identity for "no turns yet", so effects do not re-fire every render. */
const EMPTY_THREAD: Turn[] = [];

// A reference the meetings surface passes to open Earn with server-side context.
// Only the id + mode travel from the browser; the sensitive prep/follow-up
// context is gathered and injected on the server (see /api/chat).
type MeetingChatContext = { id: string; mode: "prep" | "followup" };

// One turn in the in-dock conversation: the operator's message, or Earn's
// routed plan in reply. Every turn carries a stable `id` so it can be edited or
// deleted on its own without the surrounding conversation shifting underneath.
type Turn =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "earn";
      planTitle?: string;
      steps?: { agent: AgentKey; title: string }[];
      sessionId?: string;
      // Conversational (ungated) answer path: streamed markdown text. When
      // `answer` is defined the turn is a chat reply, not a routed plan.
      answer?: string;
      streaming?: boolean;
      // Set when the operator pressed Stop mid-answer. The partial text is kept
      // and labelled, so a short reply never reads as a complete one.
      stopped?: boolean;
    };

/** A stable id for a conversation turn. */
let turnSeq = 0;
function newTurnId(): string {
  turnSeq += 1;
  return `t${Date.now().toString(36)}-${turnSeq}`;
}

/** The editable text of a turn — the message, the answer, or the plan title. */
function turnText(turn: Turn): string {
  return turn.role === "user" ? turn.text : (turn.answer ?? turn.planTitle ?? "");
}

/**
 * The app-wide Earn copilot dock: a ⌘K slide-over present on every page that
 * reads the operator's current location, surfaces the on-point specialist plus
 * a live briefing and context suggestions, and maintains a multi-turn
 * conversation with Earn (persisted across reloads and in-app navigation).
 */
export function EarnCopilotDock({ name }: { name: string }) {
  const pathname = usePathname() || "/";
  const hidden = dockHiddenOn(pathname);
  const ctx = copilotContextFromPath(pathname);
  const specialist = AGENT_BY_KEY[onPointAgent(ctx)];
  const suggestions = suggestionsFor(ctx);
  const team = ctx.hub ? AGENTS.filter((a) => a.hub === ctx.hub) : [];
  // A readable name for wherever the operator is standing — the raw context is
  // a slug ("deal_room"), which is not something to show anyone.
  const sectionLabel = titleCase(ctx.module ?? ctx.hub ?? "workspace");
  // Conversation identity: the place. A deal owns one conversation across all
  // its modules; every other location owns its own.
  const conversationKey = conversationKeyForPath(pathname);
  // Resolved for deal routes so the conversation carries the deal's own name;
  // null everywhere else, where the path already reads as a place.
  const [dealName, setDealName] = useState<string | null>(null);
  const conversationLabel = conversationLabelForPath(pathname, dealName);

  const [open, setOpen] = useState(false);
  // Some surfaces with their own Earn entry points ask to hide the floating
  // launcher pill; ⌘K still opens the dock.
  const [launcherSuppressed, setLauncherSuppressed] = useState(false);
  const [body, setBody] = useState("");
  // Every conversation this tab knows about, filed by the place it belongs to.
  // The dock reads and writes only the one for where the operator is standing,
  // so a deal's turns are never sent as context for a question about Wallet.
  const [store, setStore] = useState<ConversationStore<Turn>>(() => ({ version: 2, conversations: [] }));
  const [error, setError] = useState<string | null>(null);
  const [lastAsk, setLastAsk] = useState<string>("");
  const [briefing, setBriefing] = useState<CopilotBriefing | null>(null);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [pending, start] = useTransition();
  // True while a conversational answer is streaming in (separate from `pending`,
  // which covers the server-action plan path).
  const [chatting, setChatting] = useState(false);
  // The turn currently open for editing, plus its working copy. Any entry —
  // yours or Earn's — can be rewritten in place.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Whether the recent-conversations menu is open.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Whether the share menu is open, and the outcome of the last share attempt.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareState, setShareState] = useState<
    | { kind: "idle" }
    | { kind: "working"; scope: ShareScope }
    | { kind: "linked"; url: string; scope: ShareScope }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  // The in-flight answer stream, so Stop can end it and keep what arrived.
  const chatAbortRef = useRef<AbortController | null>(null);
  // Gates the persist effect until the initial hydrate has run, so the empty
  // mount-time state never overwrites a previously saved conversation.
  const hydrated = useRef(false);

  // Hydrate every stored conversation, adopting any pre-v2 single-thread blob
  // into whichever place the operator happens to be standing in.
  useEffect(() => {
    try {
      const loaded = parseStore<Turn>(sessionStorage.getItem(CONVERSATIONS_KEY));
      const legacy = sessionStorage.getItem(LEGACY_THREAD_KEY);
      const merged = migrateLegacyThread(loaded, legacy, {
        key: conversationKey,
        label: conversationLabel,
        now: Date.now(),
      });
      // Clear any streaming flag left over from a reload mid-answer, and
      // backfill ids for turns saved before they carried one.
      setStore({
        version: merged.version,
        conversations: merged.conversations.map((c) => ({
          ...c,
          thread: c.thread.map((t) => ({
            ...t,
            id: t.id || newTurnId(),
            ...(t.role === "earn" && t.streaming ? { streaming: false } : null),
          })),
        })),
      });
      if (legacy) sessionStorage.removeItem(LEGACY_THREAD_KEY);
    } catch {
      /* ignore malformed storage */
    }
    hydrated.current = true;
    // Runs once: the adopted-into key is whichever place the dock first loaded on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(store));
    } catch {
      /* storage may be unavailable */
    }
  }, [store]);

  // The conversation for where the operator is standing. Reading and writing go
  // through here, so nothing can accidentally address a different place's turns.
  const active = findConversation(store, conversationKey);
  const thread = active?.thread ?? EMPTY_THREAD;
  const sessionId = active?.sessionId ?? null;
  const recent = otherConversations(store, conversationKey);

  /**
   * Hand the conversation to someone else. A public link reuses the share
   * plumbing that already backs /s/[token]; the download needs no server at all.
   * Both are no-ops on an empty thread — there is nothing to hand over yet.
   */
  async function shareLink(scope: ShareScope) {
    if (!sessionId) {
      setShareState({ kind: "error", message: "Ask Earn something first — a conversation is created on the first reply." });
      return;
    }
    setShareState({ kind: "working", scope });
    const result = await shareEarnConversation(sessionId, scope);
    if (!result.ok || !result.url) {
      setShareState({ kind: "error", message: result.error ?? "Couldn't create a share link." });
      return;
    }
    const url = `${window.location.origin}${result.url}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be denied; the link is still shown for manual copying.
    }
    // The scope rides along so the confirmation states this link's real reach —
    // a team link and a public link look identical, and the operator is about
    // to paste one of them somewhere.
    setShareState({ kind: "linked", url, scope });
  }

  function downloadTranscript() {
    const markdown = threadToMarkdown(thread, {
      label: conversationLabel,
      operator: name,
      exportedAt: new Date(),
    });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = conversationFilename(conversationLabel, new Date());
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke on the next tick so the click has already been handled.
    setTimeout(() => URL.revokeObjectURL(href), 0);
    setShareOpen(false);
  }

  /** Replace this conversation's turns, filing it under the current place. */
  function setThread(update: Turn[] | ((prev: Turn[]) => Turn[])) {
    setStore((prev) => {
      const current = findConversation(prev, conversationKey);
      const previousThread = current?.thread ?? EMPTY_THREAD;
      const nextThread = typeof update === "function" ? update(previousThread) : update;
      return upsertConversation(prev, {
        key: conversationKey,
        label: conversationLabel,
        sessionId: current?.sessionId ?? null,
        thread: nextThread,
        updatedAt: Date.now(),
      });
    });
  }

  /** Adopt the server session this conversation now belongs to. */
  function setSessionId(id: string | null) {
    setStore((prev) => {
      const current = findConversation(prev, conversationKey);
      if (!current) return prev;
      return upsertConversation(prev, { ...current, sessionId: id, updatedAt: Date.now() });
    });
  }

  // Update the most recent Earn turn in place (used while streaming a chat answer).
  function patchLastEarn(prev: Turn[], patch: Partial<Extract<Turn, { role: "earn" }>>): Turn[] {
    const next = [...prev];
    for (let i = next.length - 1; i >= 0; i--) {
      const turn = next[i];
      if (turn.role === "earn") {
        next[i] = { ...turn, ...patch };
        break;
      }
    }
    return next;
  }

  // Prior conversation as {role, content} pairs so the chat reply is multi-turn.
  // Takes the turns explicitly so a re-ask can pass only the turns that still
  // stand after an edit, rather than the thread as it was before.
  function priorFrom(turns: Turn[]): { role: string; content: string }[] {
    return turns
      .map((turn) =>
        turn.role === "user"
          ? { role: "user", content: turn.text }
          : turn.answer
            ? { role: "assistant", content: turn.answer }
            : turn.planTitle
              ? { role: "assistant", content: turn.planTitle }
              : null,
      )
      .filter((t): t is { role: string; content: string } => t !== null)
      .slice(-30);
  }

  function buildPrior(): { role: string; content: string }[] {
    return priorFrom(thread);
  }

  // Conversational (ungated) answer: stream tokens from /api/chat straight into
  // the dock — the same seamless chat the workspace composer gets, on every
  // page. Verified Apollo contacts arrive appended in the same stream.
  async function askChat(t: string, meetingContext?: MeetingChatContext, priorOverride?: { role: string; content: string }[]) {
    const prior = priorOverride ?? buildPrior();
    setThread((prev) => [
      ...prev,
      { id: newTurnId(), role: "user", text: t },
      { id: newTurnId(), role: "earn", answer: "", streaming: true },
    ]);
    setBody("");
    setChatting(true);
    const controller = new AbortController();
    chatAbortRef.current = controller;
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: t,
          session_id: sessionId ?? undefined,
          prior,
          meeting_context: meetingContext,
          // A conversation with no session yet asks the server to open one on
          // this first reply, so it lands in /sessions instead of living only
          // in this tab. `pathname` names it after the place it happened.
          start_session: !sessionId,
          pathname,
          // The server runs in UTC; without the operator's zone "today" is a
          // day off for anyone west of Greenwich in the evening — exactly the
          // person most likely to ask what's on their plate today.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("chat failed");
      // Adopt the session the server opened for this conversation, if any.
      const opened = res.headers.get("X-Earn-Session");
      if (opened && !sessionId) setSessionId(opened);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setThread((prev) => patchLastEarn(prev, { answer: acc, streaming: true }));
      }
      setThread((prev) => patchLastEarn(prev, { answer: acc || "…", streaming: false }));
    } catch (err) {
      // Stop is not a failure: keep whatever Earn had already written and mark
      // the answer as stopped rather than replacing it with an error.
      if (err instanceof DOMException && err.name === "AbortError") {
        setThread((prev) =>
          patchLastEarn(prev, { answer: acc || "Stopped before Earn answered.", streaming: false, stopped: true }),
        );
      } else {
        setThread((prev) =>
          patchLastEarn(prev, { answer: "Earn couldn't answer that just now — please try again.", streaming: false }),
        );
      }
    } finally {
      chatAbortRef.current = null;
      setChatting(false);
    }
  }

  /** Stop the answer Earn is writing. Whatever already arrived is kept. */
  function stopAnswer() {
    chatAbortRef.current?.abort();
  }

  // Run any prompt through Earn. Informational questions stream back a
  // conversational answer (ungated); work requests are planned into a gated
  // workflow. The intent classifier decides, so the same box does both.
  //
  // A meetingContext (from the meetings "Prepare"/"Follow up" buttons) always
  // streams as chat: the visible message is a clean one-liner and the rich,
  // sensitive context is injected server-side, never sent from the browser.
  function ask(text: string, meetingContext?: MeetingChatContext) {
    const t = text.trim();
    if (!t || pending || chatting) return;
    setError(null);
    setLastAsk(t);
    if (meetingContext || classifyIntent(t) === "chat") {
      void askChat(t, meetingContext);
      return;
    }
    setThread((prev) => [...prev, { id: newTurnId(), role: "user", text: t }]);
    start(async () => {
      const r = await askEarn({ body: t, pathname, sessionId: sessionId ?? undefined });
      if (r.ok) {
        if (r.sessionId) setSessionId(r.sessionId);
        setThread((prev) => [
          ...prev,
          { id: newTurnId(), role: "earn", planTitle: r.planTitle, steps: r.steps, sessionId: r.sessionId },
        ]);
        window.dispatchEvent(new CustomEvent("earn:exec-activity", {
          detail: {
            agentKeys: r.steps?.map((s) => s.agent) ?? [],
            planTitle: r.planTitle ?? "Working on it...",
          },
        }));
        setBody("");
      } else {
        setError(r.error ?? "Something went wrong.");
      }
    });
  }

  // Always points at the latest `ask` closure so event handlers registered once
  // (below) can trigger a send without capturing a stale `ask` (which closes over
  // pending/chatting/sessionId/thread). Updated after every render.
  const askRef = useRef(ask);
  useEffect(() => {
    askRef.current = ask;
  });

  // Surfaces with their own Earn entry can hide the floating launcher pill via
  // this event. ⌘K still opens the dock.
  useEffect(() => {
    const onSuppress = (e: Event) => {
      const detail = (e as CustomEvent<{ suppress?: boolean }>).detail;
      setLauncherSuppressed(Boolean(detail?.suppress));
    };
    window.addEventListener("earn:suppress-launcher", onSuppress);
    return () => window.removeEventListener("earn:suppress-launcher", onSuppress);
  }, []);

  /**
   * Start this place's conversation over. Only this conversation is dropped —
   * every other place keeps its own, and the session it produced stays in
   * /sessions rather than being deleted.
   */
  function newConversation() {
    stopAnswer();
    setStore((prev) => removeConversation(prev, conversationKey));
    setError(null);
    setEditingId(null);
    setSwitcherOpen(false);
    setShareOpen(false);
    setShareState({ kind: "idle" });
    setBody("");
    inputRef.current?.focus();
  }

  /** Open one entry for editing, seeded with its current wording. */
  function beginEdit(turn: Turn) {
    setEditingId(turn.id);
    setDraft(turnText(turn));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  /**
   * Save the edited wording back onto the entry. The message, Earn's answer, and
   * a plan's title are all editable in place — nothing is re-run, so this is a
   * correction rather than a new ask.
   */
  function saveEdit(id: string) {
    const text = draft.trim();
    if (!text) return;
    const previous = thread.find((turn) => turn.id === id);
    if (sessionId && previous) {
      // Persist the rewrite so it survives a reload; failure leaves the
      // on-screen edit standing rather than blocking it.
      void editSessionTurn({ sessionId, turnId: id, previousContent: turnText(previous), content: text });
    }
    setThread((prev) =>
      prev.map((turn) => {
        if (turn.id !== id) return turn;
        if (turn.role === "user") return { ...turn, text };
        return turn.answer !== undefined ? { ...turn, answer: text } : { ...turn, planTitle: text };
      }),
    );
    cancelEdit();
  }

  /**
   * Save an edited message and ask it again: everything after it is dropped, so
   * the conversation continues from the corrected wording.
   */
  function saveEditAndResend(id: string) {
    const text = draft.trim();
    if (!text || pending || chatting) return;
    const index = thread.findIndex((turn) => turn.id === id);
    if (index < 0) return;
    const kept = thread.slice(0, index);
    const dropped = thread.slice(index);
    cancelEdit();
    stopAnswer();
    // The turns being replaced go from the persisted transcript too, so a reload
    // shows the corrected conversation rather than both versions of it.
    if (sessionId) {
      dropped.forEach((turn) => {
        void deleteSessionTurn({ sessionId, turnId: turn.id, content: turnText(turn) });
      });
    }
    setThread(kept);
    setError(null);
    setLastAsk(text);
    // Re-ask against only the turns that still stand, so the dropped tail never
    // leaks back in as context.
    const prior = priorFrom(kept);
    if (classifyIntent(text) === "chat") {
      setTimeout(() => void askChat(text, undefined, prior), 0);
    } else {
      setTimeout(() => askRef.current(text), 0);
    }
  }

  /**
   * Delete a single entry. Deleting the answer Earn is still writing stops the
   * stream first, so nothing streams back into a turn that no longer exists.
   */
  function deleteTurn(id: string) {
    const turn = thread.find((t) => t.id === id);
    if (turn?.role === "earn" && turn.streaming) stopAnswer();
    if (editingId === id) cancelEdit();
    if (sessionId && turn) {
      void deleteSessionTurn({ sessionId, turnId: id, content: turnText(turn) });
    }
    setThread((prev) => prev.filter((t) => t.id !== id));
  }

  // ⌘/Ctrl-K toggles the dock; Esc closes it. Inert where the dock is hidden.
  // Also listens for earn:open-with-context to pre-fill the input and open.
  useEffect(() => {
    if (hidden) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        // Esc stops the answer in flight first; a second press closes the dock,
        // so an operator can cut Earn off without losing the conversation.
        if (chatAbortRef.current) stopAnswer();
        else setOpen(false);
      }
    }
    function onExecContext(e: Event) {
      const detail = (e as CustomEvent<{ execName?: string; prompt?: string; autoSend?: boolean; chatContext?: MeetingChatContext }>).detail;
      setOpen(true);
      // Some senders open Earn with no pre-filled prompt (dispatching an empty
      // detail). Never store a non-string body — `body.trim()` in render would
      // otherwise crash.
      const prompt = detail?.prompt ?? "";
      const chatContext = detail?.chatContext;
      setBody(prompt);
      // A sender can ask Earn to route the task straight away (autoSend). Fire
      // it through the latest `ask` via the ref so there's
      // no stale-closure risk; the small delay lets the dock finish opening.
      // A chatContext (meeting prep/follow-up) carries the server-side context
      // reference so only a clean one-liner is ever shown or stored client-side.
      if (detail?.autoSend && prompt.trim()) {
        setTimeout(() => askRef.current(prompt, chatContext), 80);
      } else {
        setTimeout(() => inputRef.current?.focus(), 60);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("earn:open-with-context", onExecContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("earn:open-with-context", onExecContext);
    };
  }, [hidden]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // A fresh location refreshes the briefing and swaps to that place's
  // conversation. Any answer still streaming belongs to the place it was asked
  // from, so it is stopped rather than left writing into a thread the operator
  // has walked away from.
  useEffect(() => {
    setBriefing(null);
    setSwitcherOpen(false);
    // A share link is minted for one conversation; carrying it into another
    // place's menu would offer the wrong thread's URL.
    setShareOpen(false);
    setShareState({ kind: "idle" });
    setEditingId(null);
    setError(null);
    stopAnswer();
  }, [pathname]);

  // Keep the latest turn in view.
  useEffect(() => {
    if (open) threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [thread, open]);

  // Pull the live briefing for this location when the dock is open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    getCopilotBriefing(pathname).then((b) => {
      if (active) setBriefing(b);
    });
    return () => {
      active = false;
    };
  }, [open, pathname]);

  // Name the conversation after the deal, once, when the dock opens on one.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDealName(null);
    getConversationDealName(pathname).then((n) => {
      if (active) setDealName(n);
    });
    return () => {
      active = false;
    };
  }, [open, pathname]);

  // Load the standing mandate once on first open, to show what Earn may auto-run.
  useEffect(() => {
    if (!open || mandate) return;
    let active = true;
    getMandateSummary().then((m) => {
      if (active && m) setMandate(m);
    });
    return () => {
      active = false;
    };
  }, [open, mandate]);

  /** Send the current composer contents to Earn. */
  function submitAsk() {
    ask(body);
  }

  // Suppressed on the session/workspace and Workflows screens (hooks above run
  // unconditionally to satisfy the rules of hooks).
  if (hidden) return null;

  return (
    <>
      {/* Launcher */}
      {!open && !launcherSuppressed ? (
        <button
          onClick={() => setOpen(true)}
          title="Ask Earn (⌘K)"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-neural-400/45 bg-surface-1 px-4 py-2.5 text-sm font-medium text-neural-300 shadow-[0_18px_48px_-24px_rgb(var(--fx-accent-rgb)/0.378)] backdrop-blur transition hover:border-neural-300/70 hover:bg-neural-400/10 print:hidden"
        >
          <EarnOrb size={22} pulse />
          Ask Earn
          <span className="h-1.5 w-1.5 rounded-full bg-neural-400 shadow-[0_0_12px_rgb(var(--fx-accent-rgb)/0.378)] animate-glow" aria-hidden />
          <kbd className="ml-1 hidden rounded border border-neural-400/35 px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary sm:inline">⌘K</kbd>
        </button>
      ) : null}

      {/* Dock */}
      <div
        role="dialog"
        aria-label="Earn copilot"
        className={`fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-[92vw] flex-col overflow-hidden border-l border-neural-400/30 bg-surface-1 shadow-[-24px_0_60px_-30px_rgb(15_23_42/0.28)] transition-transform duration-200 print:hidden ${
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(var(--fx-accent-rgb)/0.06)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--fx-accent-rgb)/0.06)_1px,transparent_1px)] bg-[length:26px_26px]" aria-hidden />
        <div className="pointer-events-none absolute -top-20 right-6 h-56 w-56 rounded-full bg-neural-400/10 blur-3xl" aria-hidden />
        {/* Header */}
        <div className="relative z-10 flex items-start justify-between gap-3 border-b border-neural-400/20 bg-surface-1/95 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <EarnOrb size={28} pulse />
              <div className="min-w-0">
                {/* Which conversation this is. Naming the place makes it plain
                    that Wallet's turns are not in the deal's thread. */}
                <p className="truncate text-sm font-semibold text-fg-primary">
                  Earn · <span className="font-normal text-fg-secondary">{conversationLabel}</span>
                </p>
                <p className="truncate font-mono text-xs font-semibold uppercase tracking-[0.08em] text-neural-300">
                  {specialist.key !== "associate" ? (
                    <span className="inline-flex items-center gap-1">
                      <AgentDot color={specialist.color} /> {specialist.name} on point
                    </span>
                  ) : (
                    "Your operating copilot"
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Recent conversations. Each one belongs to its own place and opens
                as its own session — the dock always shows the conversation for
                where you are standing, so selecting one never mixes threads. */}
            <div className="relative">
              <button
                onClick={() => setSwitcherOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={switcherOpen}
                title="Recent conversations"
                className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition hover:text-neural-300"
              >
                Recent ▾
              </button>
              {switcherOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1.5 w-64 rounded-xl border border-line bg-surface-1 p-1 shadow-[0_20px_48px_-28px_rgb(15_23_42/0.45)]">
                  {recent.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-fg-muted">
                      No other conversations yet. Each place you ask from keeps its own.
                    </p>
                  ) : (
                    recent.map((c) =>
                      c.sessionId ? (
                        <Link
                          key={c.key}
                          href={`/session/${c.sessionId}`}
                          onClick={() => {
                            setSwitcherOpen(false);
                            setOpen(false);
                          }}
                          className="block rounded-lg px-2.5 py-1.5 transition hover:bg-surface-2"
                        >
                          <span className="block truncate text-xs font-medium text-fg-primary">{c.label}</span>
                          <span className="block truncate text-[11px] text-fg-muted">
                            {conversationPreview(c.thread)}
                          </span>
                        </Link>
                      ) : (
                        <div key={c.key} className="rounded-lg px-2.5 py-1.5">
                          <span className="block truncate text-xs font-medium text-fg-secondary">{c.label}</span>
                          <span className="block truncate text-[11px] text-fg-muted">
                            {conversationPreview(c.thread)}
                          </span>
                        </div>
                      ),
                    )
                  )}
                  <Link
                    href="/sessions"
                    onClick={() => {
                      setSwitcherOpen(false);
                      setOpen(false);
                    }}
                    className="mt-1 block rounded-lg border-t border-line px-2.5 py-1.5 text-xs font-medium text-neural-300 transition hover:bg-surface-2"
                  >
                    All conversations →
                  </Link>
                </div>
              ) : null}
            </div>
            {/* Share. The conversation already lives in a real session and
                /s/[token] already renders one publicly — this is the control
                that was missing, not the plumbing. */}
            <div className="relative">
              <button
                onClick={() => {
                  setShareOpen((o) => !o);
                  setShareState({ kind: "idle" });
                }}
                aria-haspopup="menu"
                aria-expanded={shareOpen}
                title="Share this conversation"
                className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition hover:text-neural-300"
              >
                Share ▾
              </button>
              {shareOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1.5 w-72 rounded-xl border border-line bg-surface-1 p-1 shadow-[0_20px_48px_-28px_rgb(15_23_42/0.45)]">
                  {thread.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-fg-muted">
                      Nothing to share yet — ask Earn something first.
                    </p>
                  ) : (
                    <>
                      {/* Team first, deliberately: it is the safer default, and
                          the one an operator sharing internally actually wants. */}
                      <button
                        onClick={() => void shareLink("org")}
                        disabled={shareState.kind === "working"}
                        className="block w-full rounded-lg px-2.5 py-1.5 text-left transition hover:bg-surface-2 disabled:opacity-50"
                      >
                        <span className="block text-xs font-medium text-fg-primary">
                          {shareState.kind === "working" && shareState.scope === "org"
                            ? "Creating link…"
                            : "Copy team link"}
                        </span>
                        <span className="block text-[11px] text-fg-muted">
                          Only signed-in members of your firm can open it
                        </span>
                      </button>
                      <button
                        onClick={() => void shareLink("public")}
                        disabled={shareState.kind === "working"}
                        className="block w-full rounded-lg px-2.5 py-1.5 text-left transition hover:bg-surface-2 disabled:opacity-50"
                      >
                        <span className="block text-xs font-medium text-fg-primary">
                          {shareState.kind === "working" && shareState.scope === "public"
                            ? "Creating link…"
                            : "Copy public link"}
                        </span>
                        <span className="block text-[11px] text-status-warning">
                          Anyone with the link can read this conversation
                        </span>
                      </button>
                      <button
                        onClick={downloadTranscript}
                        className="block w-full rounded-lg px-2.5 py-1.5 text-left transition hover:bg-surface-2"
                      >
                        <span className="block text-xs font-medium text-fg-primary">Download as Markdown</span>
                        <span className="block text-[11px] text-fg-muted">A .md file of the full thread</span>
                      </button>
                    </>
                  )}
                  {shareState.kind === "linked" ? (
                    <p className="mt-1 break-all border-t border-line px-2.5 py-1.5 text-[11px] text-neural-300">
                      <span className="font-medium">
                        {shareState.scope === "org" ? "Team link copied" : "Public link copied"}
                      </span>
                      {" · "}
                      {shareState.url}
                    </p>
                  ) : null}
                  {shareState.kind === "error" ? (
                    <p className="mt-1 border-t border-line px-2.5 py-1.5 text-[11px] text-status-danger">
                      {shareState.message}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-fg-muted transition hover:text-neural-300"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="relative z-10 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Live briefing — where things stand in this context */}
          {briefing ? (
            <div className="fx-neural-card p-3">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-neural-300">Where things stand</p>
              <p className="mt-1 text-sm font-medium text-fg-primary">{briefing.headline}</p>
              {briefing.stats.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {briefing.stats.map((st) => (
                    <span key={st.label} className="inline-flex items-baseline gap-1 text-xs">
                      <span
                        className={`font-mono font-semibold ${
                          st.tone === "good"
                            ? "text-status-success"
                            : st.tone === "bad"
                              ? "text-status-danger"
                              : st.tone === "warn"
                                ? "text-neural-300"
                                : "text-fg-primary"
                        }`}
                      >
                        {st.value}
                      </span>
                      <span className="text-fg-muted">{st.label}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {briefing.nextAction ? (
                <button
                  onClick={() => ask(briefing.nextAction!.prompt)}
                  disabled={pending}
                  className="mt-2.5 flex w-full items-center gap-2 rounded-lg border border-neural-400/30 bg-neural-400/5 px-3 py-2 text-left transition hover:bg-neural-400/10 disabled:opacity-50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neural-400 font-mono text-[11px] text-white shadow-[0_0_12px_rgb(var(--fx-accent-rgb)/0.231)]">
                    →
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold uppercase tracking-[0.1em] text-neural-300">
                      Do this next
                    </span>
                    <span className="block truncate text-sm text-fg-primary">{briefing.nextAction.label}</span>
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Suggestions */}
          <div>
            <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-neural-300">
              Suggested next · {sectionLabel}
            </p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => {
                const tier = suggestionTier(s);
                const agent = AGENT_BY_KEY[s.agent];
                const auto = willAutoRun(s, mandate ?? undefined);
                return (
                  <form key={s.id} action={launchCopilotSuggestion}>
                    <input type="hidden" name="pathname" value={pathname} />
                    <input type="hidden" name="suggestion_id" value={s.id} />
                    <button className="group w-full rounded-xl border border-neural-400/15 bg-surface-0 p-3 text-left transition hover:border-neural-400/45 hover:bg-neural-400/[0.06]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium text-fg-primary">{s.label}</span>
                        {tier ? (
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${TIER_TONE[tier]}`}
                            title={`${TIER_LABEL[tier]} — ${tier === 1 ? "runs freely" : tier === 2 ? "your standing mandate may auto-approve" : "always needs your sign-off"}`}
                          >
                            {TIER_LABEL[tier]}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-fg-secondary">{s.hint}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg-secondary">
                          <AgentDot color={agent.color} /> <span className="truncate">{agent.name}</span>
                        </span>
                        <span
                          className={`shrink-0 text-xs font-semibold ${
                            auto ? "text-status-success" : "text-fg-muted"
                          }`}
                          title={
                            auto
                              ? "Earn runs this now under your standing mandate"
                              : "Earn drafts the plan; you approve before it runs"
                          }
                        >
                          {auto ? "Earn runs this" : "Needs your approval"}
                        </span>
                      </div>
                    </button>
                  </form>
                );
              })}
            </div>
          </div>

          {/* Recent runs — review/approve the copilot's recent workflows */}
          <ReviewFeed open={open} onClose={() => setOpen(false)} />

          {/* Personal tasks — assigned human work that can launch through Earn */}
          <TeamTasksFeed open={open} pathname={pathname} />

          {/* Conversation — the maintained, multi-turn session in the dock */}
          {thread.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-neural-300">Your conversation</p>
                <div className="flex items-center gap-2">
                  {sessionId ? (
                    <Link
                      href={`/session/${sessionId}`}
                      onClick={() => setOpen(false)}
                      className="text-xs font-medium text-fg-secondary underline-offset-2 transition hover:text-neural-300 hover:underline"
                    >
                      Open full session
                    </Link>
                  ) : null}
                  <button
                    onClick={newConversation}
                    className="text-xs font-medium text-fg-secondary underline-offset-2 transition hover:text-neural-300 hover:underline"
                  >
                    Start new
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {thread.map((turn) => {
                  const editing = editingId === turn.id;
                  const streaming = turn.role === "earn" && turn.streaming === true;
                  // Every entry carries the same two controls — rewrite it, or
                  // remove it from the conversation entirely.
                  const controls = (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {streaming ? (
                        <button
                          onClick={stopAnswer}
                          className="rounded border border-status-danger/40 bg-status-danger/10 px-2 py-0.5 text-[11px] font-semibold text-status-danger transition hover:bg-status-danger/20"
                        >
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={() => beginEdit(turn)}
                          className="text-[11px] font-medium text-fg-muted underline-offset-2 transition hover:text-neural-300 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => deleteTurn(turn.id)}
                        className="text-[11px] font-medium text-fg-muted underline-offset-2 transition hover:text-status-danger hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  );

                  // The in-place editor, shared by every kind of entry.
                  const editor = (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") cancelEdit();
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            saveEdit(turn.id);
                          }
                        }}
                        rows={3}
                        aria-label="Edit this entry"
                        className="w-full resize-y rounded-lg border border-neural-400/40 bg-surface-1 px-3 py-2 text-sm text-fg-primary focus:border-neural-400 focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => saveEdit(turn.id)}
                          disabled={!draft.trim()}
                          className="rounded-md bg-neural-400 px-2.5 py-1 text-[12px] font-semibold text-white transition hover:bg-neural-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Save
                        </button>
                        {turn.role === "user" ? (
                          <button
                            onClick={() => saveEditAndResend(turn.id)}
                            disabled={!draft.trim() || pending || chatting}
                            title="Save this message and ask Earn again from here"
                            className="rounded-md border border-neural-400/50 px-2.5 py-1 text-[12px] font-medium text-neural-300 transition hover:bg-neural-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Save &amp; ask again
                          </button>
                        ) : null}
                        <button
                          onClick={cancelEdit}
                          className="text-[12px] font-medium text-fg-muted transition hover:text-fg-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );

                  if (turn.role === "user") {
                    return (
                      <div key={turn.id} className="ml-6">
                        {editing ? (
                          editor
                        ) : (
                          <div className="break-words rounded-lg rounded-br-sm border border-line bg-surface-2/80 px-3 py-2 text-sm text-fg-primary">
                            {turn.text}
                          </div>
                        )}
                        {editing ? null : controls}
                      </div>
                    );
                  }

                  if (turn.answer !== undefined) {
                    // Conversational answer (streamed markdown), incl. any
                    // appended verified-contact block.
                    return (
                      <div key={turn.id} className="mr-6">
                        {editing ? (
                          editor
                        ) : (
                          <>
                            <div className="rounded-lg rounded-bl-sm border border-neural-400/30 bg-neural-400/[0.06] px-3 py-2 text-sm text-fg-primary shadow-[0_0_22px_-18px_rgb(var(--fx-accent-rgb)/0.378)]">
                              <Markdown>{turn.answer || "…"}</Markdown>
                              {turn.streaming ? (
                                <span className="ml-0.5 inline-block h-3 w-1.5 animate-glow bg-neural-400 align-middle" aria-hidden />
                              ) : null}
                            </div>
                            {turn.stopped ? (
                              <p className="mt-1 text-[11px] font-medium text-fg-muted">
                                You stopped this answer — it may be incomplete.
                              </p>
                            ) : null}
                            {controls}
                          </>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={turn.id} className="mr-6 space-y-2">
                      {editing ? (
                        editor
                      ) : (
                        <>
                          <div className="rounded-lg rounded-bl-sm border border-neural-400/30 bg-neural-400/[0.06] px-3 py-2 shadow-[0_0_22px_-18px_rgb(var(--fx-accent-rgb)/0.378)]">
                            {turn.planTitle ? (
                              <p className="break-words text-sm font-medium text-fg-primary">{turn.planTitle}</p>
                            ) : null}
                            {turn.steps?.length ? (
                              <ul className="mt-1.5 flex flex-col gap-1">
                                {turn.steps.map((st, j) => {
                                  const a = AGENT_BY_KEY[st.agent];
                                  return (
                                    <li key={j} className="flex items-center gap-2 text-xs text-fg-secondary">
                                      <AgentDot color={a?.color ?? "#888"} />
                                      <span className="shrink-0 text-fg-muted">{a?.name ?? st.agent}</span>
                                      <span className="min-w-0 truncate">{st.title}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                          </div>
                          {/* What you can do with this plan */}
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              onClick={() => {
                                window.dispatchEvent(new CustomEvent("earn-delegate", {
                                  detail: { planTitle: turn.planTitle, steps: turn.steps },
                                }));
                                setOpen(false);
                              }}
                              className="flex-1 rounded border border-gold-500/60 bg-gold-500/10 px-2 py-1 text-[12px] font-semibold text-gold-300 transition hover:border-gold-500 hover:bg-gold-500/20 active:scale-95"
                            >
                              Approve &amp; automate
                            </button>
                            <button
                              onClick={() => askRef.current(lastAsk)}
                              disabled={!lastAsk || pending || chatting}
                              title="Ask Earn to plan this again"
                              className="rounded border border-line bg-surface-2 px-2 py-1 text-[12px] font-medium text-fg-secondary transition hover:bg-surface-3 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Redo plan
                            </button>
                            <button
                              onClick={() => deleteTurn(turn.id)}
                              className="rounded border border-status-danger/40 bg-status-danger/5 px-2 py-1 text-[12px] font-medium text-status-danger transition hover:bg-status-danger/15 active:scale-95"
                            >
                              Decline
                            </button>
                          </div>
                          {controls}
                        </>
                      )}
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-status-danger/30 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
              <p>{error}</p>
              {lastAsk ? (
                <button
                  onClick={() => ask(lastAsk)}
                  disabled={pending}
                  className="mt-1.5 text-xs font-semibold text-status-danger underline underline-offset-2 hover:text-status-danger disabled:opacity-50"
                >
                  Try again →
                </button>
              ) : null}
            </div>
          ) : null}

          {/* The team on point here */}
          {team.length > 0 ? (
            <div>
              <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-neural-300">Your team on this page</p>
              <div className="flex flex-wrap gap-1.5">
                {team.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => {
                      setBody((b) => (b ? b : `Have ${a.name} `));
                      inputRef.current?.focus();
                    }}
                    title={a.role}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neural-400/25 bg-surface-0 px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-neural-400/60 hover:text-fg-primary"
                  >
                    <AgentDot color={a.color} />
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Ask box */}
        <div className="relative z-10 border-t border-neural-400/20 bg-surface-1/95 p-3 backdrop-blur">
          <textarea
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitAsk();
              }
            }}
            rows={2}
            placeholder={`Ask Earn to help, ${name.split(" ")[0]}…`}
            className="w-full resize-none rounded-lg border border-neural-400/20 bg-surface-1/95 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-neural-400/70 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-fg-muted">Press ⌘↵ to send</span>
            <div className="flex items-center gap-2">
              {/* Stop is only offered while an answer is actually streaming —
                  the routed-plan path runs server-side and cannot be cut off. */}
              {chatting ? (
                <button
                  onClick={stopAnswer}
                  title="Stop Earn's answer and keep what it has written so far"
                  className="rounded-md border border-status-danger/50 bg-status-danger/10 px-3 py-1.5 text-sm font-semibold text-status-danger transition hover:bg-status-danger/20"
                >
                  Stop
                </button>
              ) : null}
              <button
                onClick={submitAsk}
                disabled={pending || chatting || !body.trim()}
                title={!body.trim() && !pending && !chatting ? "Type a message to ask Earn" : undefined}
                className="rounded-md bg-neural-400 px-3 py-1.5 text-sm font-semibold text-white shadow-[0_0_18px_rgb(var(--fx-accent-rgb)/0.101)] transition hover:bg-neural-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {chatting ? "Answering…" : pending ? "Routing…" : "Ask Earn"}
              </button>
            </div>
          </div>
          <div className="mt-2 text-center">
            <Link
              href="/settings/mandate"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-fg-secondary underline-offset-2 transition hover:text-neural-300 hover:underline"
            >
              ⚙ Review what Earn is allowed to do
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
