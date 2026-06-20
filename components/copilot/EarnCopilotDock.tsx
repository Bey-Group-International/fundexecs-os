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
} from "@/lib/copilot";
import { askEarn, launchCopilotSuggestion, type AskEarnResult } from "@/components/copilot/actions";

function AgentDot({ color }: { color: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />;
}

const TIER_TONE: Record<number, string> = {
  1: "border-emerald-400/40 text-emerald-300",
  2: "border-gold-500/40 text-gold-300",
  3: "border-status-danger/40 text-status-danger",
};

export function EarnCopilotDock({ name }: { name: string }) {
  const pathname = usePathname() || "/";
  const ctx = copilotContextFromPath(pathname);
  const earn = AGENT_BY_KEY.associate;
  const specialist = AGENT_BY_KEY[onPointAgent(ctx)];
  const suggestions = suggestionsFor(ctx);
  const team = ctx.hub ? AGENTS.filter((a) => a.hub === ctx.hub) : [];

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [result, setResult] = useState<AskEarnResult | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ⌘/Ctrl-K toggles the dock; Esc closes it.
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // A fresh location resets the inline plan result.
  useEffect(() => {
    setResult(null);
  }, [pathname]);

  function submitAsk() {
    if (!body.trim() || pending) return;
    start(async () => {
      const r = await askEarn({ body, pathname });
      setResult(r);
      if (r.ok) setBody("");
    });
  }

  return (
    <>
      {/* Launcher */}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          title="Ask Earn (⌘K)"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-gold-500/40 bg-surface-1 px-4 py-2.5 text-sm font-medium text-gold-300 shadow-lg shadow-black/40 transition hover:bg-surface-2 print:hidden"
        >
          <span className="text-base leading-none">✶</span>
          Ask Earn
          <kbd className="ml-1 rounded border border-line px-1 font-mono text-[10px] text-fg-muted">⌘K</kbd>
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
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/10 text-sm text-gold-300">
                ✶
              </span>
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
          {/* Suggestions */}
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-gold-400">
              Next best · {ctx.module ? ctx.module.replace(/_/g, " ") : ctx.hub ?? "workspace"}
            </p>
            <div className="flex flex-col gap-2">
              {suggestions.map((s) => {
                const tier = suggestionTier(s);
                const agent = AGENT_BY_KEY[s.agent];
                return (
                  <form key={s.id} action={launchCopilotSuggestion}>
                    <input type="hidden" name="pathname" value={pathname} />
                    <input type="hidden" name="suggestion_id" value={s.id} />
                    <button className="group w-full rounded-xl border border-line bg-surface-0/40 p-3 text-left transition hover:border-gold-500/40 hover:bg-surface-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-fg-primary">{s.label}</span>
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
                      <p className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        <AgentDot color={agent.color} /> {agent.name}
                      </p>
                    </button>
                  </form>
                );
              })}
            </div>
          </div>

          {/* Inline plan result from an ask */}
          {result?.ok && result.steps ? (
            <div className="rounded-xl border border-gold-500/30 bg-gold-500/5 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                Earn routed your ask
              </p>
              <p className="mt-1 text-sm font-medium text-fg-primary">{result.planTitle}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {result.steps.map((st, i) => {
                  const a = AGENT_BY_KEY[st.agent];
                  return (
                    <li key={i} className="flex items-center gap-2 text-xs text-fg-secondary">
                      <AgentDot color={a?.color ?? "#888"} />
                      <span className="text-fg-muted">{a?.name ?? st.agent}</span>
                      <span className="truncate">{st.title}</span>
                    </li>
                  );
                })}
              </ul>
              {result.sessionId ? (
                <Link
                  href={`/session/${result.sessionId}`}
                  onClick={() => setOpen(false)}
                  className="mt-2 inline-block rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-xs font-medium text-gold-300 transition hover:bg-gold-500/20"
                >
                  Open session →
                </Link>
              ) : null}
            </div>
          ) : null}
          {result && !result.ok ? (
            <p className="rounded-lg border border-status-danger/30 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
              {result.error}
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
        </div>
      </div>
    </>
  );
}
