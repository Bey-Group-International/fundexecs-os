'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Mail,
  Sparkles,
  Send,
  MessageCircle,
  X,
  Users,
  ShieldCheck,
  Compass,
  Check
} from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { Badge } from '@/components/ui';
import { TEAM_ROSTER, TeamAvatar } from '@/lib/team';
import { MEMBER_TYPES, MEMBER_TYPE_LABELS, MEMBER_TYPE_BLURBS } from '@/lib/member-types';
import { claimBetaLinkWithEmail } from '@/lib/actions/beta-links';
import { BETA_APPLICATION_COOKIE, type BetaApplication } from '@/lib/beta/welcome';

type Scene = 'welcome' | 'breakdown' | 'apply' | 'enter';
type Topic = 'intro' | 'team' | 'value';

/* ── tiny char-by-char reveal for Earn's lines (queueMicrotask reset keeps the
      react-hooks/set-state-in-effect rule happy) ───────────────────────────── */
function useTypewriter(text: string, speed = 16): string {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let i = 0;
    queueMicrotask(() => setCount(0));
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return text.slice(0, count);
}

/** Earn's speech bubble — coin + typed line. */
function EarnSays({ line, size = 44 }: { line: string; size?: number }) {
  const typed = useTypewriter(line);
  return (
    <div className="flex items-start gap-3.5">
      <div className="relative flex-none">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(circle, rgba(247,201,72,0.4), transparent 65%)',
            filter: 'blur(18px)'
          }}
          aria-hidden
        />
        <EarnCoin size={size} glow online />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-1">Earn</p>
        <p className="mt-1 min-h-[1.6em] text-[15px] leading-7 text-fg-1">
          {typed}
          <span className="ml-0.5 inline-block h-[1.05em] w-px translate-y-[2px] animate-pulse bg-gold-1 align-middle" />
        </p>
      </div>
    </div>
  );
}

/** Reactive choice chip. */
function Chip({
  children,
  onClick,
  active,
  icon: Icon
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  icon?: typeof Users;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium transition ${
        active
          ? 'border-gold-1/60 bg-[var(--gold-soft,var(--surface-2))] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-2 hover:border-gold-1/40 hover:text-fg-1'
      }`}
    >
      {Icon && <Icon size={15} strokeWidth={1.9} aria-hidden />}
      {children}
    </button>
  );
}

const PRIMARY_BTN =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-5 py-2.5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 disabled:opacity-60';

function persistApplication(app: BetaApplication) {
  try {
    const val = encodeURIComponent(JSON.stringify(app));
    const secure =
      typeof location !== 'undefined' && location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${BETA_APPLICATION_COOKIE}=${val}; path=/; max-age=86400; samesite=lax${secure}`;
  } catch {
    // Non-fatal: onboarding still works, it just won't be pre-filled.
  }
}

/* ── live "ask Earn anything" box (token-gated, streamed) ───────────────────── */
type Turn = { role: 'user' | 'assistant'; content: string };

function AskEarn({ token, onClose }: { token: string; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    const next = [...turns, { role: 'user' as const, content: q }];
    setTurns([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/beta/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, messages: next })
      });
      if (!res.ok || !res.body) {
        const { error } = await res
          .json()
          .catch(() => ({ error: 'Earn is unavailable right now.' }));
        setTurns((t) => withLastAssistant(t, error ?? 'Earn is unavailable right now.'));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as { type: string; text?: string; message?: string };
            if (evt.type === 'delta' && evt.text) acc += evt.text;
            if (evt.type === 'degraded' && evt.message) acc = evt.message;
            setTurns((t) => withLastAssistant(t, acc));
          } catch {
            // ignore partial/non-JSON lines
          }
        }
      }
    } catch {
      setTurns((t) =>
        withLastAssistant(t, "I couldn't reach myself just now — try again in a moment.")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[420px] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-hairline bg-surface-1 shadow-[var(--shadow-lg)]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2.5">
          <EarnCoin size={26} online />
          <span className="text-[13px] font-semibold text-fg-1">Ask Earn</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-fg-4 transition hover:text-fg-1"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        {turns.length === 0 && (
          <p className="text-[12.5px] leading-6 text-fg-4">
            Curious about the program, the team, or what you get? Ask me anything before you join.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'text-right' : ''}>
            <span
              className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-6 ${
                t.role === 'user'
                  ? 'bg-[linear-gradient(135deg,#3B74F0,#2152D8)] text-white'
                  : 'border border-hairline bg-surface-2 text-fg-2'
              }`}
            >
              {t.content || (busy ? '…' : '')}
            </span>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-hairline p-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Earn…"
          maxLength={600}
          className="w-full rounded-xl border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg-1 placeholder:text-fg-5 outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={busy}
          className={PRIMARY_BTN + ' px-3 py-2'}
          aria-label="Send"
        >
          <Send size={15} strokeWidth={2} aria-hidden />
        </button>
      </form>
    </div>
  );
}

function withLastAssistant(turns: Turn[], content: string): Turn[] {
  const copy = [...turns];
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === 'assistant') {
      copy[i] = { role: 'assistant', content };
      break;
    }
  }
  return copy;
}

/* ── the experience ────────────────────────────────────────────────────────── */
export function ClaimView({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const redirectedError = searchParams.get('error');

  const [scene, setScene] = useState<Scene>('welcome');
  const [topic, setTopic] = useState<Topic>('intro');
  const [askOpen, setAskOpen] = useState(false);

  // application capture
  const [name, setName] = useState('');
  const [memberType, setMemberType] = useState<string | null>(null);
  const [goal, setGoal] = useState('');

  // auth
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(redirectedError);

  const firstName = name.trim().split(/\s+/)[0] || '';

  const breakdownLine: Record<Topic, string> = {
    intro:
      'FundExecs OS is one command center where your sourcing, diligence, capital, and relationships run as a single intelligence layer — not fifteen disconnected tools.',
    team: 'Fifteen specialists, each a brain trained for one job — sourcing, diligence, capital, legal, IR. You bring the work; I route it to the right one.',
    value:
      'In the beta you get early access, a direct line to the team, and a real say in what we build. Command Center, Pipeline, and a Chain of Trust on every decision.'
  };

  function startEmailClaim(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    persistApplication({
      name: name.trim(),
      memberType: memberType ?? undefined,
      goal: goal.trim()
    });
    claimBetaLinkWithEmail(token, email)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          setLoading(false);
          return;
        }
        window.location.href = result.message;
      })
      .catch(() => {
        setError('Could not start sign-in. Please try again.');
        setLoading(false);
      });
  }

  function startGoogleClaim() {
    setLoading(true);
    setError(null);
    persistApplication({
      name: name.trim(),
      memberType: memberType ?? undefined,
      goal: goal.trim()
    });
    window.location.assign(
      `/api/auth/google?next=${encodeURIComponent('/beta/claim/complete?token=' + token)}`
    );
  }

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg-0 px-6 py-12 text-fg-1"
      style={{
        background:
          'radial-gradient(60% 50% at 80% 8%, rgba(247,201,72,0.12), transparent 70%), radial-gradient(55% 55% at 0% 95%, rgba(37,99,235,0.12), transparent 70%), linear-gradient(180deg, var(--bg-0), var(--bg-1))'
      }}
    >
      {/* header: identity + progress */}
      <div className="mb-8 flex w-full max-w-xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <EarnCoin size={26} />
          <span className="text-[14px] font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          {(['welcome', 'breakdown', 'apply', 'enter'] as Scene[]).map((s, i) => {
            const order = ['welcome', 'breakdown', 'apply', 'enter'];
            const done = order.indexOf(scene) >= i;
            return (
              <span
                key={s}
                className={`h-1.5 rounded-full transition-all ${done ? 'w-6 bg-gold-1' : 'w-3 bg-[var(--border)]'}`}
              />
            );
          })}
        </div>
      </div>

      <div key={scene} className="fx-rise w-full max-w-xl">
        {error && (
          <p className="mb-5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        {/* ── WELCOME ── */}
        {scene === 'welcome' && (
          <div className="flex flex-col gap-7">
            <Badge tone="gold" dot pulse className="self-start">
              Private beta · invitation
            </Badge>
            <EarnSays
              size={56}
              line="Welcome. I'm Earn — Earnest Fundmaker, your private-market assistant. You've been invited into the FundExecs OS private beta."
            />
            <p className="max-w-md text-[13.5px] leading-7 text-fg-3">
              I lead a fifteen-strong AI executive team. Give me ninety seconds to show you what
              that means for you — then I&apos;ll get you in.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <button type="button" onClick={() => setScene('breakdown')} className={PRIMARY_BTN}>
                Show me <ArrowRight size={15} strokeWidth={2} aria-hidden />
              </button>
              <Chip icon={MessageCircle} onClick={() => setAskOpen(true)}>
                Ask Earn a question
              </Chip>
            </div>
          </div>
        )}

        {/* ── BREAKDOWN ── */}
        {scene === 'breakdown' && (
          <div className="flex flex-col gap-6">
            <EarnSays line={breakdownLine[topic]} />

            <div className="flex flex-wrap gap-2">
              <Chip icon={Compass} active={topic === 'intro'} onClick={() => setTopic('intro')}>
                What it is
              </Chip>
              <Chip icon={Users} active={topic === 'team'} onClick={() => setTopic('team')}>
                Meet the team
              </Chip>
              <Chip icon={ShieldCheck} active={topic === 'value'} onClick={() => setTopic('value')}>
                What I get
              </Chip>
            </div>

            {topic === 'team' && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TEAM_ROSTER.slice(0, 9).map((m) => (
                  <div
                    key={m.slug}
                    className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 p-2.5"
                  >
                    <TeamAvatar member={m} size={30} className="flex-none" />
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-fg-1">{m.name}</div>
                      <div className="truncate text-[10px] uppercase tracking-[0.08em] text-azure-1">
                        {m.position}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => setScene('apply')} className={PRIMARY_BTN}>
                I&apos;m ready <ArrowRight size={15} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setScene('welcome')}
                className="text-[12.5px] font-medium text-fg-4 transition hover:text-fg-2"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* ── APPLY ── */}
        {scene === 'apply' && (
          <div className="flex flex-col gap-6">
            <EarnSays
              line={
                !name
                  ? "Let's make it yours. First — what should I call you?"
                  : !memberType
                    ? `Good to meet you, ${firstName}. Which of these is closest to you?`
                    : `${MEMBER_TYPE_BLURBS[memberType as keyof typeof MEMBER_TYPE_BLURBS]} Noted. Last thing — what's the one outcome you want from FundExecs OS?`
              }
            />

            <div>
              <label htmlFor="name" className="text-[12px] font-medium text-fg-3">
                Your name
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sam Rivera"
                className="mt-1.5 w-full rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-[13.5px] text-fg-1 placeholder:text-fg-5 outline-none focus:border-[var(--accent)]"
              />
            </div>

            {name.trim() && (
              <div className="fx-rise">
                <p className="mb-2 text-[12px] font-medium text-fg-3">I am a…</p>
                <div className="flex flex-wrap gap-2">
                  {MEMBER_TYPES.map((mt) => (
                    <Chip key={mt} active={memberType === mt} onClick={() => setMemberType(mt)}>
                      {memberType === mt && <Check size={14} strokeWidth={2.2} aria-hidden />}
                      {MEMBER_TYPE_LABELS[mt]}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {memberType && (
              <div className="fx-rise">
                <label htmlFor="goal" className="text-[12px] font-medium text-fg-3">
                  What you want (optional)
                </label>
                <input
                  id="goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. close my next raise faster"
                  className="mt-1.5 w-full rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-[13.5px] text-fg-1 placeholder:text-fg-5 outline-none focus:border-[var(--accent)]"
                />
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setScene('enter')}
                disabled={!name.trim() || !memberType}
                className={PRIMARY_BTN}
              >
                Take me in <ArrowRight size={15} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setScene('breakdown')}
                className="text-[12.5px] font-medium text-fg-4 transition hover:text-fg-2"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* ── ENTER ── */}
        {scene === 'enter' && (
          <div className="flex flex-col gap-6">
            <EarnSays
              size={56}
              line={`You're set${firstName ? `, ${firstName}` : ''}. One step — confirm it's you, and I'll have your desk ready and the right specialists on call.`}
            />

            <div className="rounded-2xl border border-hairline bg-surface-1 p-6 shadow-[var(--shadow-lg)]">
              <button
                type="button"
                onClick={startGoogleClaim}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-hairline bg-surface-2 px-4 py-2.5 text-[13.5px] font-medium transition hover:bg-surface-3 disabled:opacity-60"
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 18 18">
                  <path
                    fill="#4285F4"
                    d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
                  />
                  <path
                    fill="#34A853"
                    d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
                  />
                </svg>
                Continue with Google
              </button>

              <div className="my-5 flex items-center gap-3 text-[10.5px] uppercase tracking-[0.11em] text-fg-5">
                <span className="h-px flex-1 bg-[var(--border)]" />
                or claim with email
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>

              <form onSubmit={startEmailClaim} className="space-y-3">
                <div className="relative">
                  <Mail
                    size={15}
                    strokeWidth={1.9}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5"
                    aria-hidden
                  />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@fund.com"
                    disabled={loading}
                    className="w-full rounded-xl border border-hairline bg-surface-2 py-2.5 pl-9 pr-3 text-[13.5px] text-fg-1 placeholder:text-fg-5 outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <button type="submit" disabled={loading} className={PRIMARY_BTN + ' w-full'}>
                  {loading ? 'Please wait…' : 'Get my access link'}
                  {!loading && <ArrowRight size={15} strokeWidth={2} aria-hidden />}
                </button>
              </form>
            </div>

            <p className="text-center text-[11px] text-fg-5">
              One-time setup · no password required · Secured by Supabase Auth
            </p>
          </div>
        )}
      </div>

      {/* persistent Ask-Earn launcher + panel */}
      {scene !== 'welcome' && !askOpen && (
        <button
          type="button"
          onClick={() => setAskOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-4 py-2.5 text-[12.5px] font-medium text-fg-2 shadow-[var(--shadow-lg)] transition hover:text-fg-1"
        >
          <Sparkles size={15} strokeWidth={1.9} className="text-gold-1" aria-hidden />
          Ask Earn
        </button>
      )}
      {askOpen && (
        <div className="fixed bottom-5 right-5 z-40">
          <AskEarn token={token} onClose={() => setAskOpen(false)} />
        </div>
      )}
    </main>
  );
}
