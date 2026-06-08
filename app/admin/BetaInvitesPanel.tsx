'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Send, Copy, Check, RefreshCw, Ban, Link2, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Input, SectionTitle, type BadgeTone } from '@/components/ui';
import {
  inviteBetaUser,
  resendBetaInvite,
  revokeBetaInvite,
  deleteBetaInvite
} from '@/lib/actions/beta-invites';
import type { BetaInvite } from '@/lib/queries/beta-invites';

const STATUS_TONE: Record<BetaInvite['status'], BadgeTone> = {
  pending: 'warning',
  accepted: 'success',
  revoked: 'neutral'
};

const STATUS_LABEL: Record<BetaInvite['status'], string> = {
  pending: 'Pending',
  accepted: 'Joined',
  revoked: 'Revoked'
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

/** A copyable magic-link box shown right after an invite link is minted. */
function LinkBox({ link, onDone }: { link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context) — the field is selectable.
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--success-line)] bg-[var(--success-soft)] p-3.5">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-success">
        <Link2 size={14} strokeWidth={1.9} aria-hidden />
        Magic invite link ready — copy and send it to your beta user
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
          One-time use. The link signs them in — new users start onboarding, returning users land
          back in the app.
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

export function BetaInvitesPanel({ invites }: { invites: BetaInvite[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setLink(null);
    const result = await inviteBetaUser(email, note);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLink(result.link);
    setEmail('');
    setNote('');
    router.refresh();
  }

  async function handleResend(id: string) {
    setBusyId(id);
    setError(null);
    setLink(null);
    const result = await resendBetaInvite(id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLink(result.link);
    router.refresh();
  }

  async function handleRevoke(id: string) {
    setBusyId(id);
    setError(null);
    const result = await revokeBetaInvite(id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(id: string, email: string) {
    if (busyId) return;
    if (!window.confirm(`Delete the invite for ${email}? This can’t be undone.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const result = await deleteBetaInvite(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not delete invite. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const pending = invites.filter((i) => i.status === 'pending').length;
  const joined = invites.filter((i) => i.status === 'accepted').length;

  return (
    <div className="flex flex-col gap-[18px]">
      <Card>
        <SectionTitle
          eyebrow="Private beta"
          title="Invite beta users"
          className="mb-3"
          action={
            <span className="text-[11px] text-fg-5">
              {pending} pending · {joined} joined
            </span>
          }
        />
        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-fg-3">
          Generate a one-time magic link for a prospective beta user, then copy it and send it
          however you like. Clicking the link signs them in and drops them straight into onboarding
          — no password required.
        </p>

        <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="Email"
              type="email"
              required
              icon={Mail}
              placeholder="founder@fund.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Note (optional)"
              placeholder="e.g. Referred by Sam"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" icon={Send} disabled={loading}>
            {loading ? 'Generating…' : 'Create invite link'}
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
        <div className="grid grid-cols-[1.8fr_0.8fr_0.9fr_0.9fr_1fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          <span>Email</span>
          <span>Status</span>
          <span>Invited</span>
          <span>Joined</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="h-px bg-hairline" />
        {invites.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-fg-5">
            No beta invites yet. Generate one above to get started.
          </div>
        ) : (
          invites.map((inv) => {
            const isBusy = busyId === inv.id;
            return (
              <div
                key={inv.id}
                className="grid grid-cols-[1.8fr_0.8fr_0.9fr_0.9fr_1fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-fg-1">{inv.email}</div>
                  {inv.note && <div className="truncate text-[11px] text-fg-5">{inv.note}</div>}
                </div>
                <div>
                  <Badge tone={STATUS_TONE[inv.status]} className="text-[10px]">
                    {STATUS_LABEL[inv.status]}
                  </Badge>
                </div>
                <span className="text-[11.5px] text-fg-4">{relativeTime(inv.invitedAt)}</span>
                <span className="text-[11.5px] text-fg-4">{relativeTime(inv.acceptedAt)}</span>
                <div className="flex justify-end gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={inv.status === 'accepted' ? Send : RefreshCw}
                    disabled={isBusy}
                    onClick={() => handleResend(inv.id)}
                    aria-label={
                      inv.status === 'accepted'
                        ? `Send a fresh sign-in link to ${inv.email}`
                        : `Resend invite to ${inv.email}`
                    }
                  >
                    {inv.status === 'accepted'
                      ? 'Send sign-in link'
                      : inv.status === 'revoked'
                        ? 'Re-invite'
                        : 'Resend'}
                  </Button>
                  {inv.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Ban}
                      disabled={isBusy}
                      onClick={() => handleRevoke(inv.id)}
                      aria-label={`Revoke invite for ${inv.email}`}
                    >
                      Revoke
                    </Button>
                  )}
                  {inv.status !== 'accepted' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      disabled={isBusy}
                      onClick={() => handleDelete(inv.id, inv.email)}
                      aria-label={`Delete invite for ${inv.email}`}
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
