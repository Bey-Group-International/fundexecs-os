'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, KeyRound, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';

export interface ConnectButtonProps {
  provider: string;
  /** Whether a connection row already exists in a connected state. */
  connected: boolean;
}

export function ConnectButton({ provider, connected }: ConnectButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const isApiKeyProvider = provider === 'apollo';

  async function handleOAuthConnect() {
    setBusy(true);
    setError(null);
    setResult(null);
    window.location.assign(`/api/integrations/${provider}/connect`);
  }

  async function handleApiKeyConnect() {
    if (!showApiKey) {
      setShowApiKey(true);
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/integrations/${provider}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Connect failed (${res.status})`);
        return;
      }
      setResult('Connected');
      await handleSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setBusy(false);
    }
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
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-[210px] flex-col items-end gap-1.5">
      {!connected && isApiKeyProvider && showApiKey ? (
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Apollo API key"
          type="password"
          className="h-8 w-full rounded-xl border border-hairline bg-surface-2 px-3 text-[12px] text-fg-1 outline-none placeholder:text-fg-5 focus:border-[var(--azure-1)]"
          disabled={busy}
        />
      ) : null}

      {connected ? (
        <Button
          variant="secondary"
          size="sm"
          icon={busy ? RefreshCw : Check}
          disabled={busy}
          onClick={handleSync}
        >
          {busy ? 'Syncing...' : 'Sync'}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          icon={isApiKeyProvider ? KeyRound : Plus}
          disabled={busy || (isApiKeyProvider && showApiKey && apiKey.trim().length === 0)}
          onClick={isApiKeyProvider ? handleApiKeyConnect : handleOAuthConnect}
        >
          {busy ? 'Connecting...' : showApiKey ? 'Save & sync' : 'Connect'}
        </Button>
      )}
      {result && <span className="text-right text-[11px] text-emerald-400">{result}</span>}
      {error && <span className="text-right text-[11px] text-rose-400">{error}</span>}
    </div>
  );
}
