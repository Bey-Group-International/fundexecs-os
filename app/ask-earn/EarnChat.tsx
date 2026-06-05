'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, ArrowUp } from 'lucide-react';
import { Card } from '@/components/ui';
import { TeamAvatar, getCOO } from '@/lib/team';
import { cn } from '@/lib/utils';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  /** True when this assistant turn is a degraded fallback (different visual). */
  degraded?: boolean;
};

export function EarnChat() {
  const earn = getCOO();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ask-earn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next })
      });
      const data = await res.json();
      // Auth / payload errors still come back as proper 4xx — surface them.
      if (!res.ok) {
        setError(data.error || 'Earn failed to respond.');
        return;
      }
      // Never-block degraded shape: 200 + { ok:false, degraded:true, fallback_message }.
      if (data && data.degraded === true && typeof data.fallback_message === 'string') {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: data.fallback_message, degraded: true }
        ]);
        return;
      }
      setMessages((m) => [...m, { role: 'assistant', content: data.text as string }]);
    } catch {
      // Hard network/parse failure — surface a calm message inline, no toast.
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: "I couldn't reach the network just now. Try once more — the team's still here.",
          degraded: true
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  const hasThread = messages.length > 0 || loading || error;

  return (
    <div className="flex flex-col gap-2.5">
      {hasThread && (
        <Card className="flex max-h-[360px] flex-col gap-3 overflow-y-auto p-4">
          {messages.map((m, i) => (
            <div key={i} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
              {m.role === 'assistant' && (
                <TeamAvatar member={earn} size={24} className="mt-0.5 flex-none" />
              )}
              <div
                className={cn(
                  'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed',
                  m.role === 'user'
                    ? 'bg-white text-[#070b14]'
                    : m.degraded
                      ? 'border border-[var(--gold-line)] bg-[var(--gold-soft)] text-fg-2'
                      : 'border border-hairline bg-surface-1 text-fg-2'
                )}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-fg-4">
              <TeamAvatar member={earn} size={24} className="flex-none" />
              <span className="animate-pulse">Earn is thinking…</span>
            </div>
          )}
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <div ref={endRef} />
        </Card>
      )}

      <form
        onSubmit={send}
        className="flex items-center gap-2.5 rounded-[11px] border border-hairline bg-surface-2 px-3 py-2"
      >
        <Sparkles size={15} strokeWidth={1.9} className="flex-none text-gold-1" aria-hidden />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Earn or run a command — “Build an LP list”, “Review my deck like an LP”…"
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
}
