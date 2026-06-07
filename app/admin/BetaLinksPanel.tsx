'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, Send, Copy, Check, Ban } from 'lucide-react';
import { Badge, Button, Card, Input, SectionTitle, type BadgeTone } from '@/components/ui';
import { createBetaLink, revokeBetaLink } from '@/lib/actions/beta-links';
import type { BetaLinkWithStatus } from '@/lib/queries/beta-links';

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  revoked: 'neutral',
  expired: 'neutral'
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired'
};

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function relativeExpiry(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, then - Date.now());
  if (diff <= 0) return 'expired';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'expiring soon';
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

/** Copyable link box shown after link creation. */
function LinkBox({ link, onDone }: { link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked.
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] p-3.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-success">
        <Link2 size={14} strokeWidth={1.9} aria-hidden />
        Beta link ready — copy and share it
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full truncate rounded-lg border border-hairline bg-surface-1 px-3 py-2 font-mono text-[11.5px] text-fg-2 outline-none"
        />
        <Button variant="primary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[11px] text-fg-5">
          Share this link to let recipients claim beta access via email or Google.
        </p>
        <button
          type="button"
          onClick={onDone}
          className="text-[11px] font-medium text-fg-4 transition hover:text-fg-2"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function BetaLinksPanel({ links }: { links: BetaLinkWithStatus[] }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('25');
  const [expiryDays, setExpiryDays] = useState('14');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setLink(null);
    const result = await createBetaLink(label, 'member', parseInt(maxUses) || 25, parseInt(expiryDays) || 14);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLink(result.link);
    setLabel('');
    setMaxUses('25');
    setExpiryDays('14');
    router.refresh();
  }

  async function handleRevoke(id: string) {
    setBusyId(id);
    setError(null);
    const result = await revokeBetaLink(id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  const active = links.filter((l) => l.status === 'active').length;

  return (
    <div className="flex flex-col gap-[18px]">
      <Card>
        <SectionTitle
          eyebrow="Shareable links"
          title="Create beta access links"
          className="mb-3"
          action={
            <span className="text-[11px] text-fg-5">
              {active} active
            </span>
          }
        />
        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-fg-3">
          Generate a reusable link that anyone can claim via email or Google sign-in. No email delivery needed — just copy and share.
        </p>

        <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="Label (optional)"
              placeholder="e.g., Wave 2 LPs"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex-0">
            <Input
              label="Max uses"
              type="number"
              min="1"
              max="1000"
              placeholder="25"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="flex-0">
            <Input
              label="Expires (days)"
              type="number"
              min="1"
              max="365"
              placeholder="14"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" icon={Send} disabled={loading}>
            {loading ? 'Creating…' : 'Create link'}
          </Button>
        </form>

        {error && (
          <p className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        {link && <LinkBox link={link} onDone={() => setLink(null)} />}
      </Card>

      <Card className="p-2">
        <div className="grid grid-cols-[1fr_1fr_0.8fr_0.9fr_0.9fr_1fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          <span>Label</span>
          <span>Role</span>
          <span>Uses</span>
          <span>Expires</span>
          <span>Status</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="h-px bg-hairline" />
        {links.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-fg-5">
            No beta links yet. Create one above to get started.
          </div>
        ) : (
          links.map((l) => {
            const isBusy = busyId === l.id;
            return (
              <div
                key={l.id}
                className="grid grid-cols-[1fr_1fr_0.8fr_0.9fr_0.9fr_1fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-fg-1">
                    {l.label || '(no label)'}
                  </div>
                </div>
                <div className="text-[11.5px] text-fg-4 capitalize">{l.role}</div>
                <div className="text-[11.5px] text-fg-4">
                  {l.claimsCount}/{l.maxUses}
                </div>
                <div className="text-[11.5px] text-fg-4">{relativeExpiry(l.expiresAt)}</div>
                <div>
                  <Badge tone={STATUS_TONE[l.status] || 'neutral'} className="text-[10px]">
                    {STATUS_LABEL[l.status] || l.status}
                  </Badge>
                </div>
                <div className="flex justify-end gap-1.5">
                  {l.status === 'active' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Ban}
                      disabled={isBusy}
                      onClick={() => handleRevoke(l.id)}
                      aria-label={`Revoke link ${l.label || ''}`}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
