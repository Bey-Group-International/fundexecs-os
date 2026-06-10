'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Sparkles
} from 'lucide-react';
import { Avatar, Badge, Button, Card, Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import { PROVIDER_META, syncedLabel, type IntegrationView } from '@/lib/integrations/catalog';
import { SYNC_FREQUENCY_OPTIONS, DEFAULT_SYNC_FREQUENCY } from '@/lib/integrations/sync-frequency';

/* ============================================================================
 * IntegrationCard — a single provider card with live management controls.
 *
 * • available + not connected → Connect (OAuth redirect or API-key entry)
 * • available + connected     → Sync now, plus an expandable "Manage" panel
 *                               (account, last sync, sync-frequency preference,
 *                               Reconnect, Disconnect)
 * • available + error         → recovery banner (Retry sync / Reconnect)
 * • comingSoon                → "Request access" (catalogued, not yet wired)
 *
 * Connect/sync/disconnect hit the existing /api/integrations/:provider routes.
 * The sync-frequency control persists to the connection row via
 * /api/integrations/:provider/frequency, so the cadence is durable and
 * cross-device (a future scheduler reads it server-side).
 * ========================================================================= */

type Msg = { tone: 'ok' | 'error' | 'muted'; text: string } | null;

export function IntegrationCard({ conn }: { conn: IntegrationView }) {
  const router = useRouter();
  const meta = PROVIDER_META[conn.provider];
  const Icon = meta.icon;
  const connected = conn.status === 'connected';
  const error = conn.status === 'error';
  const available = conn.available;
  const isApiKey = meta.connect === 'api_key';

  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect' | 'request'>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [expanded, setExpanded] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [requested, setRequested] = useState(conn.requested);
  // Seed from the persisted per-connection cadence (falls back to the default).
  const [freq, setFreq] = useState(conn.sync_frequency ?? DEFAULT_SYNC_FREQUENCY);
  const [freqSaving, setFreqSaving] = useState(false);

  function toggleManage() {
    setExpanded((open) => !open);
  }

  async function onFreqChange(value: string) {
    const previous = freq;
    setFreq(value);
    setFreqSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/integrations/${conn.provider}/frequency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: value })
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setFreq(previous);
        setMsg({ tone: 'error', text: data?.error ?? `Could not save (${res.status})` });
      }
    } catch (err) {
      setFreq(previous);
      setMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setFreqSaving(false);
    }
  }

  async function handleOAuthConnect() {
    setBusy('connect');
    window.location.assign(`/api/integrations/${conn.provider}/connect`);
  }

  async function handleApiKeyConnect() {
    if (!showApiKey) {
      setShowApiKey(true);
      return;
    }
    setBusy('connect');
    setMsg(null);
    try {
      const res = await fetch(`/api/integrations/${conn.provider}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setMsg({ tone: 'error', text: data?.error ?? `Connect failed (${res.status})` });
        return;
      }
      setShowApiKey(false);
      setApiKey('');
      await handleSync();
      router.refresh();
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Connect failed' });
    } finally {
      setBusy(null);
    }
  }

  async function handleSync() {
    setBusy('sync');
    setMsg(null);
    try {
      const res = await fetch(`/api/integrations/${conn.provider}/sync`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        contacts?: number;
        interactions?: number;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setMsg({ tone: 'error', text: data?.error ?? `Sync failed (${res.status})` });
      } else {
        setMsg({
          tone: 'ok',
          text: `Synced ${data.contacts ?? 0} contacts, ${data.interactions ?? 0} interactions`
        });
        router.refresh();
      }
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setBusy(null);
    }
  }

  async function handleRequestAccess() {
    setBusy('request');
    setMsg(null);
    try {
      const res = await fetch('/api/integrations/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: conn.provider })
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setMsg({ tone: 'error', text: data?.error ?? `Request failed (${res.status})` });
        return;
      }
      setRequested(true);
      setMsg({ tone: 'ok', text: "Requested — we'll email you when it's ready" });
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    setBusy('disconnect');
    setMsg(null);
    try {
      const res = await fetch(`/api/integrations/${conn.provider}/disconnect`, { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setMsg({ tone: 'error', text: data?.error ?? `Disconnect failed (${res.status})` });
        return;
      }
      setConfirmDisconnect(false);
      setExpanded(false);
      setMsg({ tone: 'muted', text: 'Disconnected' });
      router.refresh();
    } catch (err) {
      setMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Disconnect failed' });
    } finally {
      setBusy(null);
    }
  }

  const statusBadge = !available ? (
    <Badge tone="info">Coming soon</Badge>
  ) : connected ? (
    <Badge tone="success" dot>
      Connected
    </Badge>
  ) : error ? (
    <Badge tone="danger" dot>
      Needs attention
    </Badge>
  ) : (
    <Badge tone="neutral">Not connected</Badge>
  );

  return (
    <Card
      className={cn(
        'flex flex-col gap-4 p-5 transition-[border-color,box-shadow]',
        connected && 'border-[var(--success-line)]',
        error && 'border-[var(--danger-line)]'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'flex h-11 w-11 flex-none items-center justify-center rounded-xl border',
            connected
              ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
              : 'border-hairline bg-surface-2 text-fg-2'
          )}
        >
          <Icon size={20} strokeWidth={1.9} aria-hidden />
        </span>
        {statusBadge}
      </div>

      {/* Title + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[14.5px] font-semibold text-fg-1">{meta.name}</h3>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-5">
            {meta.category}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-fg-4">{meta.description}</p>
      </div>

      {/* Error / recovery banner */}
      {available && error ? (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[11.5px] text-danger">
          <AlertTriangle size={14} strokeWidth={2} className="mt-px flex-none" aria-hidden />
          <span>Last sync failed. Retry, or reconnect to refresh access.</span>
        </div>
      ) : null}

      {/* Footer: account + primary action */}
      <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {connected ? (
            <Avatar
              name={conn.external_account || meta.name}
              size={28}
              tone="success"
              aria-hidden
            />
          ) : null}
          <div className="min-w-0">
            {conn.external_account ? (
              <div className="truncate text-[12px] font-medium text-fg-2">
                {conn.external_account}
              </div>
            ) : (
              <div className="text-[12px] text-fg-5">
                {available ? 'No account linked' : 'Not yet available'}
              </div>
            )}
            <div className="text-[11px] tabular-nums text-fg-5">
              {available ? syncedLabel(conn.last_synced_at) : 'Request early access'}
            </div>
          </div>
        </div>

        {/* Action cluster */}
        <div className="flex flex-none items-center gap-1.5">
          {!available ? (
            <Button
              variant="secondary"
              size="sm"
              icon={busy === 'request' ? RefreshCw : requested ? Check : Sparkles}
              disabled={requested || busy !== null}
              onClick={handleRequestAccess}
            >
              {busy === 'request' ? 'Requesting…' : requested ? 'Requested' : 'Request access'}
            </Button>
          ) : connected ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={busy === 'sync' ? RefreshCw : Check}
                disabled={busy !== null}
                onClick={handleSync}
              >
                {busy === 'sync' ? 'Syncing…' : 'Sync'}
              </Button>
              <button
                type="button"
                onClick={toggleManage}
                aria-label="Manage integration"
                aria-expanded={expanded}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
              >
                <ChevronDown
                  size={15}
                  strokeWidth={2}
                  className={cn('transition-transform', expanded && 'rotate-180')}
                  aria-hidden
                />
              </button>
            </>
          ) : isApiKey && showApiKey ? (
            <Button
              variant="primary"
              size="sm"
              icon={busy === 'connect' ? RefreshCw : KeyRound}
              disabled={busy !== null || apiKey.trim().length < 8}
              onClick={handleApiKeyConnect}
            >
              {busy === 'connect' ? 'Saving…' : 'Save & sync'}
            </Button>
          ) : (
            <Button
              variant={error ? 'secondary' : 'primary'}
              size="sm"
              icon={error ? RotateCw : isApiKey ? KeyRound : Plus}
              disabled={busy !== null}
              onClick={isApiKey ? handleApiKeyConnect : handleOAuthConnect}
            >
              {busy === 'connect' ? 'Connecting…' : error ? 'Reconnect' : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      {/* API-key entry */}
      {available && isApiKey && !connected && showApiKey ? (
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={`${meta.name} API key`}
          type="password"
          autoComplete="off"
          disabled={busy !== null}
          className="h-9 w-full rounded-xl border border-hairline bg-surface-2 px-3 text-[12px] text-fg-1 outline-none placeholder:text-fg-5 focus:border-[var(--azure-1)]"
        />
      ) : null}

      {/* Manage panel (connected) */}
      {available && connected && expanded ? (
        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-1 p-3.5">
          <div className="grid grid-cols-2 gap-3 text-[11.5px]">
            <div>
              <div className="text-fg-5">Account</div>
              <div className="truncate font-medium text-fg-2">{conn.external_account || '—'}</div>
            </div>
            <div>
              <div className="text-fg-5">Last sync</div>
              <div className="font-medium text-fg-2">{syncedLabel(conn.last_synced_at)}</div>
            </div>
          </div>

          <Select
            label="Sync frequency"
            hint={freqSaving ? 'Saving…' : 'Saved to your workspace'}
            value={freq}
            disabled={freqSaving}
            onChange={(e) => onFreqChange(e.target.value)}
            options={[...SYNC_FREQUENCY_OPTIONS]}
          />

          <div className="flex items-center gap-2 border-t border-hairline pt-3">
            <Button
              variant="secondary"
              size="sm"
              icon={busy === 'sync' ? RefreshCw : RotateCw}
              disabled={busy !== null}
              onClick={handleSync}
            >
              Sync now
            </Button>
            <Button
              variant={confirmDisconnect ? 'danger' : 'ghost'}
              size="sm"
              icon={busy === 'disconnect' ? Loader2 : confirmDisconnect ? Power : Plug}
              disabled={busy !== null}
              onClick={handleDisconnect}
            >
              {busy === 'disconnect'
                ? 'Disconnecting…'
                : confirmDisconnect
                  ? 'Confirm disconnect'
                  : 'Disconnect'}
            </Button>
            {confirmDisconnect ? (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(false)}
                className="text-[11.5px] text-fg-4 transition hover:text-fg-2"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Result / error line */}
      {msg ? (
        <span
          className={cn(
            'text-[11px]',
            msg.tone === 'ok' && 'text-success',
            msg.tone === 'error' && 'text-danger',
            msg.tone === 'muted' && 'text-fg-5'
          )}
        >
          {msg.text}
        </span>
      ) : null}
    </Card>
  );
}

export default IntegrationCard;
