'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Link2, Copy, Check, Ban, Sparkles, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Input, SectionTitle, type BadgeTone } from '@/components/ui';
import { createBetaLink, revokeBetaLink, deleteBetaLink } from '@/lib/actions/beta-links';
import type { BetaLinkWithStatus } from '@/lib/queries/beta-links';

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  full: 'warning',
  revoked: 'neutral',
  expired: 'neutral'
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  full: 'Full',
  revoked: 'Revoked',
  expired: 'Expired'
};

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

/** The freshly-minted link: big copy field + scannable QR for sharing to phones. */
function FreshLink({ link, onDone }: { link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(link, { margin: 1, width: 220 })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        // QR is a nicety — fall back to link-only.
      });
    return () => {
      alive = false;
    };
  }, [link]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context) — the field stays selectable.
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-success">
          <Link2 size={14} strokeWidth={1.9} aria-hidden />
          Invite link ready — copy and share it
        </div>
        <button
          type="button"
          onClick={onDone}
          className="text-[11px] font-medium text-fg-4 transition hover:text-fg-2"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Invite link"
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full truncate rounded-lg border border-hairline bg-surface-1 px-3 py-2.5 font-mono text-[12px] text-fg-2 outline-none"
            />
            <Button variant="primary" size="md" icon={copied ? Check : Copy} onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-fg-5">
            Anyone who opens it claims access via email or Google, then lands straight in
            onboarding.
          </p>
        </div>

        {qr && (
          <div className="flex flex-none flex-col items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- client-side QR data URL */}
            <img
              src={qr}
              alt="QR code for the invite link"
              width={120}
              height={120}
              className="rounded-md"
            />
            <span className="text-[10px] text-fg-5">Scan to open</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function BetaLinksPanel({
  links,
  earnings = {}
}: {
  links: BetaLinkWithStatus[];
  /** beta-link id → referral credits earned, for the affiliate badge. */
  earnings?: Record<string, number>;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('25');
  const [expiryDays, setExpiryDays] = useState('14');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleCreate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setLink(null);
    try {
      const result = await createBetaLink(
        label,
        'member',
        parseInt(maxUses, 10) || 25,
        parseInt(expiryDays, 10) || 14
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLink(result.link);
      router.refresh();
    } catch {
      setError('Could not create invite link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      const result = await revokeBetaLink(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not revoke invite link. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (busyId) return;
    if (!window.confirm('Delete this invite link? This can’t be undone.')) return;
    setBusyId(id);
    setError(null);
    try {
      const result = await deleteBetaLink(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not delete invite link. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const active = links.filter((l) => l.status === 'active').length;

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Hero — one-click generation. */}
      <Card className="bg-[linear-gradient(110deg,rgba(247,201,72,0.10),transparent_55%)]">
        <SectionTitle
          eyebrow="Private beta"
          title="Shareable invite link"
          className="mb-3"
          action={<span className="text-[11px] text-fg-5">{active} active</span>}
        />
        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-fg-3">
          Generate one link to share anywhere — DM, deck, or email. Recipients claim access via
          email or Google and land straight in onboarding. No email delivery needed.
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="gold" icon={Sparkles} disabled={loading} onClick={handleCreate}>
            {loading ? 'Generating…' : 'Generate invite link'}
          </Button>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[12px] font-medium text-fg-3 transition hover:text-fg-1"
          >
            <SlidersHorizontal size={13} strokeWidth={1.9} aria-hidden />
            {showAdvanced ? 'Hide options' : 'Options'}
          </button>
          <span className="text-[11px] text-fg-5">
            Defaults: {maxUses || 25} uses · {expiryDays || 14}-day expiry
          </span>
        </div>

        {showAdvanced && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Input
              label="Label (optional)"
              placeholder="e.g., Wave 2 LPs"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input
              label="Max uses"
              type="number"
              min="1"
              max="1000"
              placeholder="25"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
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
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}

        {link && <FreshLink link={link} onDone={() => setLink(null)} />}
      </Card>

      {/* Existing links. */}
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
            No invite links yet. Generate one above to get started.
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
                  {(earnings[l.id] ?? 0) > 0 && (
                    <div className="text-[10px] font-semibold text-gold-1">
                      +{earnings[l.id].toLocaleString()} earned
                    </div>
                  )}
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
                  {l.claimsCount === 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      disabled={isBusy}
                      onClick={() => handleDelete(l.id)}
                      aria-label={`Delete link ${l.label || ''}`}
                    >
                      Delete
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
