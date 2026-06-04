'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only allow same-origin relative paths to avoid open-redirects.
  const requestedRedirect = searchParams.get('redirectedFrom');
  const redirectedFrom =
    requestedRedirect && requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//')
      ? requestedRedirect
      : '/dashboard';

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
      router.push(redirectedFrom);
      router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
      });
      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }
      setMessage('Check your email to confirm your account, then sign in.');
      setMode('signin');
    }
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#070b14] px-6 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/20">
        <h1 className="text-xl font-semibold">
          {mode === 'signin' ? 'Sign in to FundExecs OS' : 'Create your account'}
        </h1>
        <p className="mt-1 text-sm text-slate-400">Your private-market command center.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/30"
            />
          </div>

          {message && <p className="text-sm text-amber-300">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-white px-4 py-2 text-sm font-medium text-[#070b14] transition hover:bg-slate-200 disabled:opacity-60"
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setMessage(null);
          }}
          className="mt-4 w-full text-center text-sm text-slate-400 transition hover:text-slate-200"
        >
          {mode === 'signin'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </main>
  );
}
