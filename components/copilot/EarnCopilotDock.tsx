"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AGENTS, AGENT_BY_KEY } from "@/lib/agents";
import { TIER_LABEL } from "@/lib/gates";
import {
  copilotContextFromPath,
  onPointAgent,
  suggestionsFor,
  suggestionTier,
  willAutoRun,
} from "@/lib/copilot";
import {
  askEarn,
  launchCopilotSuggestion,
  getCopilotBriefing,
  getMandateSummary,
  type CopilotBriefing,
} from "@/components/copilot/actions";
import { ReviewFeed } from "@/components/copilot/ReviewFeed";
import { EarnOrb } from "@/components/copilot/EarnOrb";
import type { Mandate } from "@/lib/gates";
import type { AgentKey } from "@/lib/supabase/database.types";

/** A small colored dot used to tag a message or chip with its agent's identity. */
function AgentDot({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />;
}

const TIER_TONE: Record<number, string> = {
  1: "border-emerald-400/40 text-emerald-300",
  2: "border-gold-500/40 text-gold-300",
  3: "border-status-danger/40 text-status-danger",
};

const STORE_KEY = "earn-copilot-thread";

// One turn in the in-dock conversation: the operator's message, or Earn's
// routed plan in reply.
type Turn =
  | { role: "user"; text: string }
  | {
      role: "earn";
      planTitle?: string;
      steps?: { agent: AgentKey; title: string }[];
      sessionId?: string;
    };

/**
 * Routes where the Earn dock is suppressed: the session/workspace surfaces
 * (which *are* an Earn conversation, so the floating dock is redundant) and the
 * Workflows screen. Matched against the pathname.
 */
function dockHiddenOn(pathname: string): boolean {
  return (
    pathname === "/workspace" ||
    pathname === "/sessions" ||
    pathname === "/automations" ||
    pathname.startsWith("/session/")
  );
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

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [thread, setThread] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<CopilotBriefing | null>(null);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  // Gates the persist effect until the initial hydrate has run, so the empty
  // mount-time state never overwrites a previously saved conversation.
  const hydrated = useRef(false);

  // Hydrate the running conversation from this tab's storage so the dock keeps
  // the session across reloads, then persist on every change.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { sessionId: string | null; thread: Turn[] };
        setSessionId(saved.sessionId ?? null);
        setThread(saved.thread ?? []);
      }
    } catch {
      /* ignore malformed storage */
    }
    hydrated.current = true;
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ sessionId, thread }));
    } catch {
      /* storage may be unavailable */
    }
  }, [sessionId, thread]);

  // Run any prompt through Earn, continuing the current session so the
  // conversation is multi-turn and maintained in the dock.
  function ask(text: string) {
    const t = text.trim();
    if (!t || pending) return;
    setError(null);
    setThread((prev) => [...prev, { role: "user", text: t }]);
    start(async () => {
      const r = await askEarn({ body: t, pathname, sessionId: sessionId ?? undefined });
      if (r.ok) {
        if (r.sessionId) setSessionId(r.sessionId);
        setThread((prev) => [
          ...prev,
          { role: "earn", planTitle: r.planTitle, steps: r.steps, sessionId: r.sessionId },
        ]);
        setBody("");
      } else {
        setError(r.error ?? "Something went wrong.");
      }
    });
  }

  /** Start a fresh conversation: drop the current thread and session. */
  function newConversation() {
    setThread([]);
    setSessionId(null);
    setError(null);
    setBody("");
    inputRef.current?.focus();
  }

  // ⌘/Ctrl-K toggles the dock; Esc closes it. Inert where the dock is hidden.
  useEffect(() => {
    if (hidden) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // A fresh location refreshes the briefing, but the conversation persists —
  // the dock maintains the session as the operator moves around the app.
  useEffect(() => {
    setBriefing(null);
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
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          title="Ask Earn (⌘K)"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-gold-500/40 bg-surface-1 px-4 py-2.5 text-sm font-medium text-gold-300 shadow-lg shadow-black/40 transition hover:bg-surface-2 print:hidden"
        >
          <EarnOrb size={22} pulse />
          Ask Earn
          <kbd className="ml-1 hidden rounded border border-line px-1 font-mono text-[10px] text-fg-muted sm:inline">⌘K</kbd>
        </button>
      ) : null}

      {/* Dock */}
      <div
        role="dialog"
        aria-label="Earn copilot"
        className={`fixed inset-y-0 right-0 z-50 flex w-[380px] max-w-[92vw] flex-col border-l border-line bg-surface-1 shadow-2xl shadow-black/50 transition-transform duration-200 print:hidden ${
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <EarnOrb size={28} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg-primary">Earn</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-wider text-fg-muted">
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
          <button
            onClick={() => setOpen(false)}
            className="rounded-md px-2 py-1 text-fg-muted transition hover:text-fg-primary"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Live briefing — where things stand in this context */}
          {briefing ? (
            <div className="rounded-xl border border-line bg-surface-0/40 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">Where things stand</p>
              <p className="mt-1 text-sm font-medium text-fg-primary">{briefing.headline}</p>
              {briefing.stats.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {briefing.stats.map((st) => (
                    <span key={st.label} className="inline-flex items-baseline gap-1 text-xs">
                      <span
                        className={`font-mono font-semibold ${
                          st.tone === "good"
                            ? "text-emerald-300"
                            : st.tone === "bad"
                              ? "text-status-danger"
                              : st.tone === "warn"
                                ? "text-gold-300"
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
                  className="mt-2.5 flex w-full items-center gap-2 rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-left transition hover:bg-gold-500/10 disabled:opacity-50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold-400 font-mono text-[11px] text-surface-0">
                    →
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[9px] uppercase tracking-wider text-gold-400">
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
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Next best · {ctx.module ? ctx.module.replace(/_/g, " ") : ctx.hub ?? "workspace"}
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
                    <button className="group w-full rounded-xl border border-line bg-surface-0/40 p-3 text-left transition hover:border-gold-500/40 hover:bg-surface-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium text-fg-primary">{s.label}</span>
                        {tier ? (
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_TONE[tier]}`}
                            title={`${TIER_LABEL[tier]} — ${tier === 1 ? "runs freely" : tier === 2 ? "your standing mandate may auto-approve" : "always needs your sign-off"}`}
                          >
                            {TIER_LABEL[tier]}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-fg-secondary">{s.hint}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                          <AgentDot color={agent.color} /> <span className="truncate">{agent.name}</span>
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[9px] uppercase tracking-wider ${
                            auto ? "text-emerald-300" : "text-fg-muted"
                          }`}
                          title={
                            auto
                              ? "Earn runs this now under your standing mandate"
                              : "Earn drafts the plan; you approve before it runs"
                          }
                        >
                          {auto ? "✶ Earn runs it" : "needs approval"}
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

          {/* Conversation — the maintained, multi-turn session in the dock */}
          {thread.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">Conversation</p>
                <div className="flex items-center gap-2">
                  {sessionId ? (
                    <Link
                      href={`/session/${sessionId}`}
                      onClick={() => setOpen(false)}
                      className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300"
                    >
                      Open full →
                    </Link>
                  ) : null}
                  <button
                    onClick={newConversation}
                    className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-primary"
                  >
                    New
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {thread.map((turn, i) =>
                  turn.role === "user" ? (
                    <div key={i} className="ml-6 break-words rounded-lg rounded-br-sm border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary">
                      {turn.text}
                    </div>
                  ) : (
                    <div key={i} className="mr-6 rounded-lg rounded-bl-sm border border-gold-500/30 bg-gold-500/5 px-3 py-2">
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
                  ),
                )}
                {pending ? (
                  <div className="mr-6 inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                    <EarnOrb size={16} pulse /> Earn is routing your ask…
                  </div>
                ) : null}
                <div ref={threadEndRef} />
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-status-danger/30 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
              {error}
            </p>
          ) : null}

          {/* The team on point here */}
          {team.length > 0 ? (
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">Your team here</p>
              <div className="flex flex-wrap gap-1.5">
                {team.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => {
                      setBody((b) => (b ? b : `Have ${a.name} `));
                      inputRef.current?.focus();
                    }}
                    title={a.role}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary"
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
        <div className="border-t border-line p-3">
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
            className="w-full resize-none rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-[10px] text-fg-muted">⌘↵ to send</span>
            <button
              onClick={submitAsk}
              disabled={pending || !body.trim()}
              className="rounded-md bg-gold-400 px-3 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-40"
            >
              {pending ? "Routing…" : "Ask Earn"}
            </button>
          </div>
          <div className="mt-2 text-center">
            <Link
              href="/settings/mandate"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300"
            >
              ⚙ What Earn can do
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
