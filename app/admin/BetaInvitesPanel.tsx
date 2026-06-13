'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Mail, RotateCw, Send, Trash2, X } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  inviteBetaUser,
  resendBetaInvite,
  revokeBetaInvite,
  deleteBetaInvite
} from '@/lib/actions/beta-invites';
import type { InviteRole } from '@/lib/invites';
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

const ROLES: InviteRole[] = ['member', 'admin', 'owner'];

/**
 * Beta invites — mint an invite-by-email magic link (with the granted-on-accept
 * role), then resend / revoke / delete tracked invites. Wraps the existing
 * `inviteBetaUser` / `resendBetaInvite` / `revokeBetaInvite` / `deleteBetaInvite`
 * server actions; the minted link is shown as a copyable fallback when email
 * isn't configured. `router.refresh()` re-pulls the canonical list after writes.
 */
export function BetaInvitesPanel({ invites }: { invites: BetaInvite[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mintedLink, setMintedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setMessage(null);
    setError(null);
    setMintedLink(null);
    setCopied(false);
  }

  function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    reset();
    startTransition(async () => {
      const result = await inviteBetaUser(email.trim(), note.trim() || undefined, role);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmail('');
      setNote('');
      setMintedLink(result.link);
      setMessage(
        result.emailed
          ? `Invite emailed to ${result.email} (via ${result.via}).`
          : `Invite ready for ${result.email}. Email isn’t configured — copy the link below.`
      );
      router.refresh();
    });
  }

  function runAction(fn: () => Promise<{ ok: boolean; error?: string }>) {
    reset();
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? 'Action failed.');
      else router.refresh();
    });
  }

  async function copyLink() {
    if (!mintedLink) return;
    try {
      await navigator.clipboard.writeText(mintedLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Invite by email</h2>
      <p className="mt-1 text-[13px] text-fg-3">
        Mint a one-time magic link. New invitees land on the welcome intro; the role applies when
        they accept.
      </p>

      <form
        onSubmit={submitInvite}
        className="mt-4 rounded-2xl border border-hairline bg-bg-1 p-4 shadow-[var(--shadow-sm)]"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Mail
              size={15}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5"
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="invitee@fund.com"
              autoComplete="off"
              className="w-full rounded-xl border border-hairline bg-surface-1 py-2.5 pl-9 pr-3 text-[13.5px] text-fg-1 outline-none transition focus:border-azure-1"
            />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
            aria-label="Role granted on acceptance"
            className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-[13.5px] text-fg-1 outline-none transition focus:border-azure-1"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" icon={Send} disabled={pending}>
            {pending ? 'Sending…' : 'Send invite'}
          </Button>
        </div>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (e.g. Wave 2 LP — intro from Jordan)"
          className="mt-3 w-full rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-[13px] text-fg-1 outline-none transition focus:border-azure-1"
        />

        {error && (
          <p className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12.5px] text-danger">
            {error}
          </p>
        )}
        {message && <p className="mt-3 text-[12.5px] text-gold-1">{message}</p>}
        {mintedLink && (
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-[11.5px] text-fg-3">
              {mintedLink}
            </code>
            <Button type="button" variant="outline" size="sm" icon={Copy} onClick={copyLink}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        )}
      </form>

      <h3 className="mb-3 mt-8 text-[13px] font-semibold tracking-tight text-fg-2">
        Sent invites <span className="text-fg-5">· {invites.length}</span>
      </h3>
      {invites.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-bg-1 px-6 py-10 text-center text-[13px] text-fg-4">
          No invites sent yet.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="rounded-2xl border border-hairline bg-bg-1 p-4 shadow-[var(--shadow-sm)] sm:flex sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-fg-1">{invite.email}</span>
                  <Badge tone={STATUS_TONE[invite.status]}>{STATUS_LABEL[invite.status]}</Badge>
                </div>
                {invite.note && (
                  <p className="mt-1 truncate text-[12px] text-fg-4">{invite.note}</p>
                )}
              </div>
              <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">
                <Button
                  variant="outline"
                  size="sm"
                  icon={RotateCw}
                  disabled={pending}
                  onClick={() => runAction(() => resendBetaInvite(invite.id))}
                >
                  Resend
                </Button>
                {invite.status !== 'revoked' && invite.status !== 'accepted' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={X}
                    disabled={pending}
                    onClick={() => runAction(() => revokeBetaInvite(invite.id))}
                  >
                    Revoke
                  </Button>
                )}
                {invite.status !== 'accepted' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    disabled={pending}
                    aria-label={`Delete invite for ${invite.email}`}
                    onClick={() => runAction(() => deleteBetaInvite(invite.id))}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
