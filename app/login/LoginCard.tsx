'use client';

import { useState } from 'react';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSiteURL } from '@/lib/site-url';
import { requestPasswordReset } from '@/lib/actions/account-security';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Field } from '@/components/ui/Field';
import { signInWithPasswordAction } from './actions';

interface LoginCardProps {
  redirectedFrom: string;
  oauthError: string | null;
}

/**
 * The invite + auth card. Frames access as the prototype's beta invitation
 * ("You're invited — access is by referral"), then signs the member in with
 * Google or email/password. Password sign-in runs server-side so the session
 * cookie is readable by the middleware on the very next request.
 */
export function LoginCard({ redirectedFrom, oauthError }: LoginCardProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (mode === 'signin') {
      const result = await signInWithPasswordAction(redirectedFrom, email, password);
      if (result?.error) {
        setMessage(result.error);
        setLoading(false);
      }
      return;
    }

    const supabase = createClient();
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

  async function handleForgotPassword() {
    if (!email.trim()) {
      setMessage('Enter your email above, then tap “Forgot password?”.');
      return;
    }
    setLoading(true);
    setMessage(null);
    await requestPasswordReset(email);
    setLoading(false);
    setMessage('If an account exists for that email, a reset link is on its way.');
  }

  function handleGoogleSignIn() {
    setLoading(true);
    setMessage(null);
    // Initiate Google OAuth server-side so the PKCE code-verifier is written as
    // a server-readable cookie. The browser-side flow stranded the verifier,
    // causing "PKCE code verifier not found" at /auth/callback.
    window.location.assign(`/api/auth/google?next=${encodeURIComponent(redirectedFrom)}`);
  }

  return (
    <div className="fx-rise relative z-10 w-full max-w-[420px]">
      {/* Invite framing — the prototype's beta-invite moment, condensed. */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="relative mb-4">
          <div
            aria-hidden
            className="absolute -inset-2.5 rounded-full blur-[8px]"
            style={{
              background: 'radial-gradient(circle, rgba(247,201,72,0.45), transparent 70%)'
            }}
          />
          <div className="relative">
            <EarnCoin size={56} />
          </div>
        </div>
        <Badge tone="gold" className="mb-3">
          You&rsquo;re invited
        </Badge>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">
          Welcome to the FundExecs OS private beta
        </h1>
        <p className="mt-2 max-w-[360px] text-[13px] leading-relaxed text-fg-3">
          Access is by referral only. Your invitation reserves a desk and the full
          fifteen-specialist team.
        </p>
      </div>

      <div className="rounded-2xl border border-hairline bg-bg-1 p-7 shadow-[var(--shadow-lg)]">
        <h2 className="text-[17px] font-semibold tracking-tight">
          {mode === 'signin' ? 'Sign in to your desk' : 'Create your account'}
        </h2>
        <p className="mt-1 text-[12.5px] text-fg-4">One step from your command center.</p>

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
          <Field
            label="Work email"
            type="email"
            icon={Mail}
            required
            value={email}
            onChange={setEmail}
            placeholder="you@fund.com"
            autoComplete="email"
          />
          <div>
            <Field
              label="Password"
              type="password"
              icon={Lock}
              required
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
            {mode === 'signin' && (
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="text-[11.5px] text-fg-4 transition hover:text-fg-2 disabled:opacity-60"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          {message && <p className="text-[12.5px] text-gold-1">{message}</p>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Please wait…' : mode === 'signin' ? 'Continue' : 'Sign up'}
            {!loading && <ArrowRight size={15} strokeWidth={2} aria-hidden />}
          </Button>
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
        Next: brief your team. Takes about two minutes. · Secured by Supabase Auth · SOC 2 · RLS
      </p>
    </div>
  );
}
