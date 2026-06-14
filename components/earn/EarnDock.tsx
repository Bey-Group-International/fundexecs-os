'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  FileSearch,
  Landmark,
  ListChecks,
  Loader2,
  type LucideIcon,
  Radar,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Wand2,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { executeEarnAction } from '@/lib/actions/earn-actions';
import { EARN_NAV_DESTINATIONS } from '@/lib/ai/earn-nav';
import type { EarnOpenDetail } from '@/lib/earn/launcher';
import { TaskletQueue } from '@/components/earn/TaskletQueue';
import type { Tasklet } from '@/lib/tasklets/types';
import { TEAM_ROSTER } from '@/lib/team';
import { cn } from '@/lib/utils';

/**
 * The Earn Copilot panel — the prototype's Ask Earn surface wired to the real
 * backend, in the command-first form factor: a right-side panel on desktop, a
 * bottom sheet on mobile. The empty state leads with five primary commands
 * (Raise · Review · Find · Analyze · Ask), each landing on a real surface or
 * action, plus a contextual next-move read from live readiness. Underneath:
 * streaming NDJSON chat from /api/ask-earn (brain citations, calm
 * degradation), thread restore from /api/earn/history, auto-navigation on
 * Earn's `navigate` tool (allowlisted), and confirm cards for mutating tools.
 */

/** Where the operator is, for Earn's contextual next-move (real readiness). */
export interface EarnContext {
  hubLabel: string;
  hubHref: string;
  pct: number;
  nextLabel?: string;
  nextHref?: string;
}

interface ChatSource {
  brainId: string | null;
  snippet: string;
}

interface PendingAction {
  id: string;
  name: string;
  input: Record<string, unknown>;
  mode: 'auto' | 'confirm';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  /** Confirm-mode tool proposals attached to this assistant turn. */
  actions?: PendingAction[];
}

/** A primary command — either a real navigation, a routed ask, or focus. */
interface EarnCommand {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  href?: string;
  ask?: string;
}

const COMMANDS: EarnCommand[] = [
  {
    id: 'raise',
    label: 'Raise',
    hint: 'Plan & run the raise',
    icon: Landmark,
    href: '/source/capital-map'
  },
  {
    id: 'review',
    label: 'Review',
    hint: 'Run the committee',
    icon: FileSearch,
    href: '/run/diligence'
  },
  {
    id: 'find',
    label: 'Find',
    hint: 'Source on-thesis deals',
    icon: Radar,
    href: '/source/pipeline'
  },
  {
    id: 'analyze',
    label: 'Analyze',
    hint: 'Ask your documents',
    icon: Wand2,
    ask: 'Analyze my latest fund materials and surface what an institutional LP would flag.'
  },
  { id: 'ask', label: 'Ask', hint: 'Anything else', icon: Sparkles }
];

const SUGGESTIONS = [
  'Am I ready to raise?',
  'Score my LPs and draft outreach',
  'Review my raise like an LP',
  'Help me handle an LP objection',
  'Who should I raise from next?',
  'What should I do right now?',
  'Draft my Q2 LP letter',
  'Is my fund formation on track?'
];

const ACTION_LABEL: Record<string, string> = {
  create_deal: 'Create the deal',
  run_diligence: 'Run the committee'
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function EarnDock({
  open,
  onClose,
  context,
  openDetail
}: {
  open: boolean;
  onClose: () => void;
  context?: EarnContext | null;
  /** Starting intent handed in by the opener (a command id or a free ask). */
  openDetail?: EarnOpenDetail | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [tasklets, setTasklets] = useState<Tasklet[]>([]);
  const [taskletsLoaded, setTaskletsLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{
    ok: boolean;
    message: string;
    href?: string;
  } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const consumedDetail = useRef<EarnOpenDetail | null>(null);

  // Restore the persisted thread once per mount-open.
  useEffect(() => {
    if (!open || historyLoaded) return;
    let cancelled = false;
    fetch('/api/earn/history')
      .then((r) => r.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (!cancelled && Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, historyLoaded]);

  // Load the approve-ready tasklet queue once per mount-open. Refreshed from
  // live signals server-side; degrades to nothing if the queue is empty.
  useEffect(() => {
    if (!open || taskletsLoaded) return;
    let cancelled = false;
    fetch('/api/earn/tasklets')
      .then((r) => r.json())
      .then((data: { tasklets?: Tasklet[] }) => {
        if (!cancelled && Array.isArray(data.tasklets)) setTasklets(data.tasklets);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTaskletsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, taskletsLoaded]);

  // Dialog ergonomics.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('textarea')?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  // Keep the latest turn in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Consume a starting intent once per distinct open detail.
  useEffect(() => {
    if (!open || !historyLoaded || !openDetail) return;
    if (consumedDetail.current === openDetail) return;
    consumedDetail.current = openDetail;
    if (openDetail.command) {
      const cmd = COMMANDS.find((c) => c.id === openDetail.command);
      if (cmd) runCommand(cmd);
    } else if (openDetail.ask) {
      void send(openDetail.ask);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, historyLoaded, openDetail]);

  function runCommand(c: EarnCommand) {
    if (c.href) {
      router.push(c.href);
      onClose();
      return;
    }
    if (c.ask) {
      void send(c.ask);
      return;
    }
    panelRef.current?.querySelector<HTMLElement>('textarea')?.focus();
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    setInput('');
    setActionResult(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setStreaming(true);

    try {
      const res = await fetch('/api/ask-earn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })).slice(-12)
        })
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessages((prev) => {
          const out = [...prev];
          out[out.length - 1] = {
            role: 'assistant',
            content: err?.error ?? 'Earn is briefly offline — try again in a moment.'
          };
          return out;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const apply = (patch: (last: ChatMessage) => ChatMessage) =>
        setMessages((prev) => {
          const out = [...prev];
          out[out.length - 1] = patch(out[out.length - 1]);
          return out;
        });

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const lineStr of lines) {
          if (!lineStr.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(lineStr);
          } catch {
            continue;
          }
          if (event.type === 'delta' && typeof event.text === 'string') {
            const text = event.text;
            apply((last) => ({ ...last, content: last.content + text }));
          } else if (event.type === 'sources' && Array.isArray(event.sources)) {
            const sources = event.sources as ChatSource[];
            apply((last) => ({ ...last, sources }));
          } else if (event.type === 'degraded' && typeof event.message === 'string') {
            const message = event.message;
            apply((last) => ({ ...last, content: last.content || message }));
          } else if (event.type === 'action' && event.action && typeof event.action === 'object') {
            const action = event.action as PendingAction;
            if (action.name === 'navigate') {
              const to = String((action.input as { destination?: unknown }).destination ?? '');
              if ((EARN_NAV_DESTINATIONS as readonly string[]).includes(to)) {
                router.push(to);
                onClose();
              }
            } else if (action.mode === 'confirm') {
              apply((last) => ({ ...last, actions: [...(last.actions ?? []), action] }));
            }
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const out = [...prev];
        const last = out[out.length - 1];
        if (last.role === 'assistant' && !last.content) {
          out[out.length - 1] = {
            role: 'assistant',
            content: 'Earn is briefly offline — try again in a moment.'
          };
        }
        return out;
      });
    } finally {
      setStreaming(false);
    }
  }

  async function confirmAction(action: PendingAction) {
    setActionPending(action.id);
    setActionResult(null);
    try {
      const res = await executeEarnAction(action.name, action.input);
      setActionResult(
        res.ok
          ? { ok: true, message: res.message, href: res.href }
          : { ok: false, message: res.error }
      );
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.actions?.some((a) => a.id === action.id)
              ? { ...m, actions: m.actions.filter((a) => a.id !== action.id) }
              : m
          )
        );
      }
    } catch {
      setActionResult({ ok: false, message: 'Could not execute — try again.' });
    } finally {
      setActionPending(null);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(3,6,12,0.66)] backdrop-blur-[3px]"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Earn Copilot"
        className="fx-rise fixed inset-x-0 bottom-0 z-[61] flex max-h-[88vh] flex-col rounded-t-2xl border border-[var(--border-strong)] bg-bg-2 shadow-[0_-30px_80px_-30px_rgba(0,0,0,0.7)] lg:inset-x-auto lg:bottom-0 lg:right-0 lg:top-0 lg:max-h-none lg:w-[400px] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-hairline bg-[linear-gradient(100deg,rgba(247,201,72,0.12),transparent_60%)] px-5 py-4">
          <EarnCoin size={38} online className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-semibold text-fg-1">Earn Copilot</div>
            <div className="text-[11px] text-fg-4">
              Guide your raise, diligence, LP outreach, and fund execution.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        {/* thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {!historyLoaded ? (
            <div className="flex items-center gap-2 py-6 text-[12.5px] text-fg-4">
              <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden />
              Restoring your thread…
            </div>
          ) : messages.length === 0 ? (
            <div>
              {/* Today's tasklets — approve-ready work armed from real signals,
                  surfaced first so the operator's day opens on decisions. */}
              {tasklets.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                    <ListChecks size={12} className="text-gold-1" aria-hidden />
                    Today&apos;s tasklets · {tasklets.length}
                  </div>
                  <TaskletQueue initialTasklets={tasklets} variant="dock" />
                </div>
              )}

              {/* primary prompt + command-first grid */}
              <h2 className="text-[15.5px] font-semibold tracking-[-0.01em] text-fg-1">
                What are we moving forward today?
              </h2>
              <div className="mt-3 grid grid-cols-5 gap-1.5">
                {COMMANDS.map((c) => {
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => runCommand(c)}
                      title={c.hint}
                      className="flex flex-col items-center gap-1.5 rounded-[12px] border border-hairline bg-surface-1 px-1 py-2.5 text-center transition hover:border-[var(--gold-line)] hover:bg-[var(--gold-soft)]"
                    >
                      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
                        <Icon size={15} strokeWidth={1.9} aria-hidden />
                      </span>
                      <span className="text-[11px] font-semibold text-fg-1">{c.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* contextual next-move from live readiness */}
              {context ? (
                <button
                  type="button"
                  onClick={() => {
                    router.push(context.nextHref ?? context.hubHref);
                    onClose();
                  }}
                  className="mt-3 flex w-full items-center gap-3 rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-3 text-left transition hover:brightness-[1.03]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                      Where you are · {context.pct}% ready
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] font-semibold text-fg-1">
                      {context.nextLabel
                        ? `Continue ${context.nextLabel}`
                        : `Open ${context.hubLabel}`}
                    </span>
                  </span>
                  <ArrowRight size={15} className="flex-none text-azure-1" aria-hidden />
                </button>
              ) : null}

              <div className="mb-2 mt-5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Try
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-hairline bg-surface-1 px-3 py-1.5 text-[12px] text-fg-2 transition hover:bg-surface-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="mb-2.5 mt-6 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Your executive team · {TEAM_ROSTER.length} specialists
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {TEAM_ROSTER.map((m) => {
                  const Icon = m.icon;
                  return (
                    <div
                      key={m.slug}
                      className="flex items-center gap-2 rounded-[9px] border border-[var(--border-faint)] bg-surface-1 px-2 py-1.5"
                    >
                      {m.chief ? (
                        <EarnCoin size={22} />
                      ) : (
                        <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1">
                          <Icon size={11} strokeWidth={1.9} aria-hidden />
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold text-fg-1">{m.name}</div>
                        <div className="truncate text-[9px] text-fg-5">{m.position}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  router.push('/earn');
                  onClose();
                }}
                className="mt-3 flex w-full items-center justify-between rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-2.5 text-left transition hover:border-[var(--gold-line)] hover:bg-[var(--gold-soft)]"
              >
                <span className="flex items-center gap-2 text-[12px] font-semibold text-fg-2">
                  <ScrollText size={14} className="text-gold-1" aria-hidden />
                  Your Earn ledger — everything the team has done
                </span>
                <ArrowRight size={14} className="flex-none text-fg-4" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'user' && 'justify-end')}>
                  <div
                    className={cn(
                      'max-w-[88%] rounded-[14px] px-3.5 py-2.5 text-[12.5px] leading-relaxed',
                      m.role === 'user'
                        ? 'bg-[var(--accent-soft)] text-fg-1'
                        : 'border border-hairline bg-surface-1 text-fg-2'
                    )}
                  >
                    {m.role === 'assistant' &&
                    !m.content &&
                    streaming &&
                    i === messages.length - 1 ? (
                      <span className="flex items-center gap-2 text-fg-4">
                        <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
                        Earn is working…
                      </span>
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                    {m.sources && m.sources.length > 0 && (
                      <div className="mt-2 border-t border-[var(--border-faint)] pt-2">
                        <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-fg-5">
                          From the team&apos;s knowledge
                        </div>
                        {m.sources.slice(0, 3).map((s, j) => (
                          <div key={j} className="truncate text-[10.5px] text-fg-5">
                            · {s.snippet}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.actions?.map((a) => (
                      <div
                        key={a.id}
                        className="mt-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gold-1">
                          <ShieldCheck size={12} aria-hidden />
                          Earn proposes: {ACTION_LABEL[a.name] ?? a.name}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Button
                            variant="gold"
                            size="sm"
                            icon={actionPending === a.id ? Loader2 : Check}
                            disabled={actionPending === a.id}
                            onClick={() => void confirmAction(a)}
                          >
                            {actionPending === a.id ? 'Executing…' : 'Approve & run'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {actionResult && (
                <div
                  className={cn(
                    'flex items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-[12px]',
                    actionResult.ok
                      ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-fg-2'
                      : 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger'
                  )}
                >
                  <span className="min-w-0 flex-1">{actionResult.message}</span>
                  {actionResult.ok && actionResult.href && (
                    <button
                      type="button"
                      onClick={() => {
                        router.push(actionResult.href!);
                        onClose();
                      }}
                      className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-azure-1"
                    >
                      Open
                      <ArrowRight size={12} strokeWidth={2} aria-hidden />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* composer */}
        <div className="border-t border-hairline px-4 py-3.5">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="Ask anything — source a deal, draft an LP note, run diligence…"
              className="flex-1 resize-none rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-[13px] leading-relaxed text-fg-1 placeholder:text-fg-5 focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]"
            />
            <Button
              variant="gold"
              icon={streaming ? Loader2 : ArrowUp}
              disabled={streaming || !input.trim()}
              onClick={() => void send()}
              aria-label="Send"
            >
              Ask
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-fg-5">
            <Sparkles size={11} aria-hidden />
            Earn routes to the right specialist — mutations always come back for your approval.
          </p>
        </div>
      </div>
    </>
  );
}
