'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSiteURL } from '@/lib/site-url';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { TeamAvatar, getCOO } from '@/lib/team';

export default function LoginPage() {
  const searchParams = useSearchParams();
  // Only allow same-origin relative paths to avoid open-redirects.
  const requestedRedirect = searchParams.get('redirectedFrom');
  const redirectedFrom =
    requestedRedirect && requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//')
      ? requestedRedirect
      : '/command-center';
  const oauthError = searchParams.get('error_description') || searchParams.get('error');

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }
      // Hard navigation so the freshly-set auth cookies are sent on the next
      // request (a client router push races the cookie write and bounces back).
      window.location.assign(redirectedFrom);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${getSiteURL()}/auth/callback` }
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }
    setMessage('Check your email to confirm your account, then sign in.');
    setMode('signin');
    setLoading(false);
  }

  function handleGoogleSignIn() {
    setLoading(true);
    setMessage(null);
    // Initiate Google OAuth server-side so the PKCE code-verifier is written as a
    // server-readable cookie. The browser-side flow stranded the verifier,
    // causing "PKCE code verifier not found" at /auth/callback.
    window.location.assign(`/api/auth/google?next=${encodeURIComponent(redirectedFrom)}`);
  }

  return (
    <main className="grid min-h-screen bg-bg-0 text-fg-1 lg:grid-cols-2">
      {/* Value panel (left) */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-hairline bg-[radial-gradient(120%_80%_at_0%_0%,rgba(37,99,235,0.10),transparent_55%)] px-12 py-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <EarnCoin size={30} />
          <span className="text-[15px] font-semibold tracking-tight">
            FundExecs <span className="text-fg-3">OS</span>
          </span>
        </div>

        <div className="max-w-md">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            AI-native private-market command center
          </p>
          <h1 className="mt-4 text-[40px] font-semibold leading-[1.06] tracking-[-0.02em]">
            Turn any fund into an
            <br />
            <span className="text-gold-1">execution machine.</span>
          </h1>
          <p className="mt-5 max-w-sm text-[13.5px] leading-7 text-fg-3">
            Streamline workflows, accelerate decisions, and scale like a top-tier institution —
            without adding headcount or friction.
          </p>

          <div className="mt-10 flex gap-10 [font-feature-settings:'tnum']">
            {[
              { stat: '$612M', label: 'capital facilitated' },
              { stat: '500+', label: 'funds & sponsors' },
              { stat: '4-layer', label: 'Chain of Trust' }
            ].map((s) => (
              <div key={s.label}>
                <div className="text-[22px] font-semibold tracking-tight">{s.stat}</div>
                <div className="mt-1 text-[11.5px] text-fg-4">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-[12.5px] text-fg-4">
          <TeamAvatar member={getCOO()} size={22} />
          <span>
            <span className="font-semibold text-fg-2">Earnest Fundmaker</span> — Chief Operating
            Officer of your 15-specialist team. Call him Earn.
          </span>
        </div>
      </section>

      {/* Form card (right) */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-hairline bg-surface-1 p-7 shadow-[var(--shadow-lg)]">
            <h2 className="text-[18px] font-semibold tracking-tight">
              {mode === 'signin' ? 'Sign in to FundExecs OS' : 'Create your account'}
            </h2>
            <p className="mt-1 text-[12.5px] text-fg-4">Your private-market command center.</p>

            {oauthError && (
              <p className="mt-4 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
                {oauthError}. Please try again.
              </p>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-xl border border-hairline bg-surface-2 px-4 py-2.5 text-[13.5px] font-medium transition hover:bg-surface-3 disabled:opacity-60"
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
              or continue with email
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="text-[12px] font-medium text-fg-3">
                  Email
                </label>
                <div className="relative mt-1.5">
                  <Mail
                    size={15}
                    strokeWidth={1.9}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5"
                    aria-hidden
                  />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@fund.com"
                    className="w-full rounded-xl border border-hairline bg-surface-2 py-2.5 pl-9 pr-3 text-[13.5px] text-fg-1 placeholder:text-fg-5 focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="text-[12px] font-medium text-fg-3">
                  Password
                </label>
                <div className="relative mt-1.5">
                  <Lock
                    size={15}
                    strokeWidth={1.9}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5"
                    aria-hidden
                  />
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-hairline bg-surface-2 py-2.5 pl-9 pr-3 text-[13.5px] text-fg-1 placeholder:text-fg-5 focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              {message && <p className="text-[12.5px] text-gold-1">{message}</p>}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2.5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110 disabled:opacity-60"
              >
                {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
                {!loading && <ArrowRight size={15} strokeWidth={2} aria-hidden />}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setMessage(null);
              }}
              className="mt-5 w-full text-center text-[12.5px] text-fg-4 transition hover:text-fg-2"
            >
              {mode === 'signin'
                ? "Don't have an account? Sign up"
                : 'Already have an account? Sign in'}
            </button>
          </div>

          <p className="mt-5 text-center text-[11px] text-fg-5">
            Secured by Supabase Auth · SOC 2 · Row-Level Security
          </p>
        </div>
      </section>
    </main>
  );
}
