'use client';

import { useState } from 'react';
import { Check, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

/** Google OAuth scopes requested for read-only Calendar + Gmail metadata. */
const GOOGLE_SCOPES =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.metadata';

/** Providers that authenticate via the Supabase Google OAuth provider. */
const GOOGLE_PROVIDERS = new Set(['gmail', 'google_calendar']);

export interface ConnectButtonProps {
  provider: string;
  /** Whether a connection row already exists in a connected state. */
  connected: boolean;
}

/**
 * Starts the Google OAuth flow with offline access so the session carries a
 * `provider_token` the sync endpoint can use against Calendar / Gmail.
 */
async function signInWithGoogle() {
  const supabase = createClient();
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=/command-center`,
      scopes: GOOGLE_SCOPES,
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  });
}

export function ConnectButton({ provider, connected }: ConnectButtonProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isGoogle = GOOGLE_PROVIDERS.has(provider);

  // Non-Google providers have no live OAuth yet — surface a disabled control
  // that points operators at the documented setup.
  if (!isGoogle) {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={Plus}
        disabled
        title="Setup required — see docs/google-oauth-setup.md for the OAuth flow; this provider has no live connect yet."
        aria-label="Setup required"
      >
        Setup required
      </Button>
    );
  }

  async function handleConnect() {
    setBusy(true);
    setError(null);
    setResult(null);
    const { error: oauthError } = await signInWithGoogle();
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
    // On success the browser is redirected to Google, so no further state
    // updates are needed here.
  }

  async function handleSync() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/integrations/${provider}/sync`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        contacts?: number;
        interactions?: number;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Sync failed (${res.status})`);
      } else {
        setResult(`Synced ${data.contacts ?? 0} contacts, ${data.interactions ?? 0} interactions`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {connected ? (
        <Button
          variant="secondary"
          size="sm"
          icon={busy ? RefreshCw : Check}
          disabled={busy}
          onClick={handleSync}
        >
          {busy ? 'Syncing…' : 'Connect & sync'}
        </Button>
      ) : (
        <Button variant="primary" size="sm" icon={Plus} disabled={busy} onClick={handleConnect}>
          {busy ? 'Redirecting…' : 'Connect & sync'}
        </Button>
      )}
      {result && <span className="text-[11px] text-emerald-400">{result}</span>}
      {error && <span className="text-[11px] text-rose-400">{error}</span>}
    </div>
  );
}
