'use client';

import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowUp, BookOpen } from 'lucide-react';
import { Card } from '@/components/ui';
import { TeamAvatar, getCOO } from '@/lib/team';
import { cn } from '@/lib/utils';
import { EarnMarkdown } from '@/components/shell/earn/EarnMarkdown';
import { EarnActionCard, type EarnAction } from '@/components/shell/earn/EarnActionCard';
import { EarnCognition } from '@/components/shell/earn/EarnCognition';
import { useEarnLifecycle } from '@/components/shell/earn/useEarnLifecycle';
import { EARN_NAV_DESTINATIONS } from '@/lib/ai/earn-nav';

type Source = { brainId: string | null; snippet: string };

/** Exact in-app routes Earn may auto-navigate to. Model-supplied destinations
 *  are validated against this allowlist so a bad payload can't push an
 *  arbitrary route. Sourced from the same `EARN_NAV_DESTINATIONS` the server
 *  tool schema uses (lib/ai/earn-nav) — single source of truth, no drift. */
const AUTO_NAV_DESTINATIONS = new Set<string>(EARN_NAV_DESTINATIONS);

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  /** Reactive tool proposals streamed with this turn (navigate / create / run). */
  actions?: EarnAction[];
  /** True when this assistant turn is a degraded fallback (different visual). */
  degraded?: boolean;
};

/** Optional hint about what the operator is viewing, sent with each request. */
export interface EarnChatContext {
  kind?: string;
  entityId?: string;
  entityLabel?: string;
}

export interface EarnChatHandle {
  /** Fill the input with `text` and focus it. Does NOT send. */
  seed: (text: string) => void;
  /** Fill the input and send immediately (used by auto-run quick actions). */
  seedAndSend: (text: string) => void;
}

export interface EarnChatProps {
  /** What the dock is focused on — forwarded to the API for context-aware help. */
  context?: EarnChatContext;
  /** Notifies the dock whether there's an active thread (drives chat-first layout). */
  onThreadChange?: (hasThread: boolean) => void;
  /** Notifies the dock when a turn is in flight (drives the live agent strip). */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * EarnChat — the streaming chat surface inside the Earn dock. Restores the
 * persisted thread on mount, streams NDJSON deltas/sources/actions from
 * `/api/ask-earn`, renders markdown replies + interactive action cards,
 * auto-navigates allow-listed destinations, and reports thread/busy state up to
 * the dock. Exposes `seed` / `seedAndSend` via ref for the quick-action chips.
 */
export const EarnChat = forwardRef<EarnChatHandle, EarnChatProps>(function EarnChat(
  { context, onThreadChange, onBusyChange },
  ref
) {
  const earn = getCOO();
  const router = useRouter();
  // Phase-aware cognition lifecycle (routing → retrieving → streaming → …).
  const { phase, begin, onEvent, settle } = useEarnLifecycle();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore the persisted thread once on mount.
  useEffect(() => {
    let active = true;
    fetch('/api/earn/history', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages?: Msg[] }) => {
        if (active && Array.isArray(data.messages) && data.messages.length) {
          setMessages(data.messages);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    onThreadChange?.(messages.length > 0 || loading);
  }, [messages.length, loading, onThreadChange]);

  useEffect(() => {
    onBusyChange?.(loading);
  }, [loading, onBusyChange]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const next: Msg[] = [...messages, { role: 'user', content: trimmed }];
      setMessages(next);
      setInput('');
      setLoading(true);
      setError(null);
      begin();

      try {
        const res = await fetch('/api/ask-earn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: next.map((m) => ({ role: m.role, content: m.content })),
            context
          })
        });

        // Auth / payload errors come back as 4xx JSON.
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || 'Earn failed to respond.');
          setLoading(false);
          return;
        }

        // Open an empty assistant turn and fill it as deltas arrive.
        setMessages((m) => [...m, { role: 'assistant', content: '' }]);

        const reader = res.body?.getReader();
        if (!reader) {
          setLoading(false);
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';

        const applyEvent = (evt: {
          type: string;
          text?: string;
          sources?: Source[];
          message?: string;
          action?: EarnAction;
        }) => {
          // Drive the phase-aware cognition indicator off every event.
          onEvent(evt.type);
          // Safe navigation runs immediately (the dock persists across routes).
          if (
            evt.type === 'action' &&
            evt.action?.mode === 'auto' &&
            evt.action.name === 'navigate'
          ) {
            const dest =
              typeof evt.action.input?.destination === 'string' ? evt.action.input.destination : '';
            if (AUTO_NAV_DESTINATIONS.has(dest)) {
              router.push(dest);
            } else {
              // Blocked destination — don't render an "Opened X" chip for a
              // navigation that never happened.
              return;
            }
          }
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (!last || last.role !== 'assistant') return copy;
            if (evt.type === 'delta' && evt.text) {
              copy[copy.length - 1] = { ...last, content: last.content + evt.text };
            } else if (evt.type === 'sources' && evt.sources) {
              copy[copy.length - 1] = { ...last, sources: evt.sources };
            } else if (evt.type === 'degraded' && evt.message) {
              copy[copy.length - 1] = { ...last, content: evt.message, degraded: true };
            } else if (evt.type === 'action' && evt.action) {
              copy[copy.length - 1] = {
                ...last,
                actions: [...(last.actions ?? []), evt.action]
              };
            }
            return copy;
          });
        };

        // Read the NDJSON stream line-by-line.
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!raw) continue;
            try {
              applyEvent(JSON.parse(raw));
            } catch {
              /* ignore a malformed line */
            }
          }
        }
      } catch {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content:
              "I couldn't reach the network just now. Try once more — the team's still here.",
            degraded: true
          }
        ]);
      } finally {
        setLoading(false);
        settle();
      }
    },
    [messages, loading, context, router, begin, onEvent, settle]
  );

  useImperativeHandle(
    ref,
    () => ({
      seed(text: string) {
        if (!text) return;
        setInput(text);
        const el = inputRef.current;
        if (el) {
          el.focus();
          const len = text.length;
          requestAnimationFrame(() => el.setSelectionRange(len, len));
        }
      },
      seedAndSend(text: string) {
        void send(text);
      }
    }),
    [send]
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  const hasThread = messages.length > 0 || loading || error;

  return (
    <div className={cn('flex flex-col gap-2.5', hasThread ? 'min-h-0 flex-1' : 'flex-none')}>
      {hasThread && (
        <Card className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn('fx-rise flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}
            >
              {m.role === 'assistant' && (
                <TeamAvatar member={earn} size={24} className="mt-0.5 flex-none" />
              )}
              <div className="flex max-w-[82%] flex-col gap-1.5">
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed',
                    m.role === 'user'
                      ? 'whitespace-pre-wrap bg-white text-[#070b14]'
                      : m.degraded
                        ? 'border border-[var(--gold-line)] bg-[var(--gold-soft)] text-fg-2'
                        : 'border border-hairline bg-surface-1 text-fg-2'
                  )}
                >
                  {m.role === 'assistant' && !m.degraded ? (
                    <EarnMarkdown content={m.content} />
                  ) : (
                    m.content
                  )}
                </div>
                {m.role === 'assistant' && m.sources && m.sources.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {m.sources.slice(0, 4).map((s, si) => (
                      <span
                        key={si}
                        title={s.snippet}
                        className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-1 px-1.5 py-0.5 text-[9.5px] text-fg-4"
                      >
                        <BookOpen size={9} strokeWidth={2} aria-hidden />
                        {s.brainId ?? 'Brain'}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.role === 'assistant' && m.actions && m.actions.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {m.actions.map((a) => (
                      <EarnActionCard key={a.id} action={a} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          <EarnCognition phase={phase} />
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <div ref={endRef} />
        </Card>
      )}

      <form
        onSubmit={onSubmit}
        className="flex flex-none items-center gap-2.5 rounded-[11px] border border-hairline bg-surface-2 px-3 py-2"
      >
        <Sparkles size={15} strokeWidth={1.9} className="flex-none text-gold-1" aria-hidden />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Earn or run a command — “Build an LP list”, “Review my deck like an LP”…"
          aria-label="Ask Earn — your AI Chief Operating Officer"
          className="flex-1 bg-transparent text-[12.5px] text-fg-1 placeholder:text-fg-5 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Send"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-white text-[#070b14] transition hover:bg-slate-200 disabled:opacity-40"
        >
          <ArrowUp size={15} strokeWidth={2.2} aria-hidden />
        </button>
      </form>
    </div>
  );
});
