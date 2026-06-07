'use client';

import { useState } from 'react';
import { Mail, ArrowRight } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getSiteURL } from '@/lib/site-url';
import { claimBetaLinkWithEmail } from '@/lib/actions/beta-links';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { Badge } from '@/components/ui';
import { getCOO } from '@/lib/team';

type ClaimState = 'initial' | 'email' | 'loading' | 'error' | 'success';

/**
 * ClaimView: client component for claiming a beta link via email.
 * Mirrors app/login/page.tsx visual language.
 */
export function ClaimView({ token, onComplete }: { token: string; onComplete: () => void }) {
  const [state, setState] = useState<ClaimState>('initial');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const earn = getCOO();

  async function handleClaimEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await claimBetaLinkWithEmail(token, email);
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      setState('error');
      return;
    }

    // Redirect to the confirm URL to start signup.
    window.location.href = result.message;
  }

  function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    // Initiate Google OAuth with the beta claim flow.
    window.location.assign(
      `/api/auth/google?next=${encodeURIComponent('/beta/claim/complete?token=' + token)}`
    );
  }

  return (
    <main className="grid min-h-screen bg-bg-0 text-fg-1 lg:grid-cols-2">
      {/* Value panel (left) — mirrors login page */}
      <section
        className="relative hidden flex-col justify-between overflow-hidden border-r border-hairline px-12 py-10 lg:flex"
        style={{
          background:
            'radial-gradient(60% 50% at 80% 15%, rgba(247,201,72,0.12), transparent 70%), radial-gradient(55% 55% at 0% 90%, rgba(37,99,235,0.12), transparent 70%), linear-gradient(180deg, var(--bg-0), var(--bg-1))'
        }}
      >
        <div className="flex items-center gap-2.5">
          <EarnCoin size={28} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </span>
        </div>

        <div className="max-w-md">
          <Badge tone="gold" dot pulse className="mb-6">
            Led by Earn, your live AI guide
          </Badge>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-fg-1">
            Unified intelligence layer for the{' '}
            <span className="text-gold-1">private markets.</span>
          </h1>
          <p className="mt-5 max-w-sm text-[14px] leading-7 text-fg-3">
            A fifteen-strong executive team — led by Earn — working as one to optimize your
            workflows, accelerate your decisions, and elevate your capacity to execute like an
            institution.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-none">
            <div
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background: 'radial-gradient(circle, rgba(247,201,72,0.4), transparent 65%)',
                filter: 'blur(22px)'
              }}
              aria-hidden
            />
            <EarnCoin size={52} glow online />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-1">
              Meet Earn
            </p>
            <p className="mt-1 text-[14px] font-semibold text-fg-1">
              {earn.name} &ldquo;Earn&rdquo;
            </p>
            <p className="mt-0.5 text-[12px] text-fg-4">{earn.position} · your live AI guide</p>
          </div>
        </div>
      </section>

      {/* Claim form (right) */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-hairline bg-surface-1 p-7 shadow-[var(--shadow-lg)]">
            <h2 className="text-[18px] font-semibold tracking-tight">
              Claim your beta access
            </h2>
            <p className="mt-1 text-[12.5px] text-fg-4">
              Join FundExecs OS — invite-only beta.
            </p>

            {state === 'error' && error && (
              <p className="mt-4 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
                {error}
              </p>
            )}

            {state === 'initial' || state === 'error' ? (
              <>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-xl border border-hairline bg-surface-2 px-4 py-2.5 text-[13.5px] font-medium transition hover:bg-surface-3 disabled:opacity-50"
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

                <button
                  type="button"
                  onClick={() => setState('email')}
                  className="w-full text-center text-[12.5px] font-medium text-fg-3 transition hover:text-fg-1"
                >
                  Claim with email
                </button>
              </>
            ) : state === 'email' ? (
              <form onSubmit={handleClaimEmail} className="mt-5 space-y-4">
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
                      disabled={loading}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-4 py-2.5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition hover:shadow-[0_4px_12px_rgba(59,116,240,0.4)] disabled:opacity-50"
                >
                  {loading ? 'Please wait…' : 'Claim with email'}
                  {!loading && <ArrowRight size={15} strokeWidth={2} aria-hidden />}
                </button>

                <button
                  type="button"
                  onClick={() => setState('initial')}
                  className="w-full text-center text-[12.5px] text-fg-4 transition hover:text-fg-2"
                  disabled={loading}
                >
                  Back
                </button>
              </form>
            ) : null}
          </div>

          <p className="mt-5 text-center text-[11px] text-fg-5">
            Secured by Supabase Auth · SOC 2 · Row-Level Security
          </p>
        </div>
      </section>
    </main>
  );
}
