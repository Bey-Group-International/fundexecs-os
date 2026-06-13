'use client';

import { useState, useTransition } from 'react';
import { CheckCheck, Copy, Mail, TrendingUp, Users } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { inviteBetaUser } from '@/lib/actions/beta-invites';
import type { ReferralOverview, ReferralTier } from '@/lib/queries/referrals';

function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`;
}

function relDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ReferralPanel({
  referralUrl,
  code,
  overview,
  tiers
}: {
  referralUrl: string | null;
  code: string | null;
  overview: ReferralOverview;
  tiers: ReferralTier[];
}) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function copyLink() {
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => { /* ignore */ }
    );
  }

  function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await inviteBetaUser(email.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEmail('');
      setMessage(
        result.emailed
          ? `Invite sent to ${result.email}.`
          : `Link ready for ${result.email} — copy it from the invite you sent.`
      );
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <StatCard
          icon={Users}
          label="People referred"
          value={String(overview.referredCount)}
        />
        <StatCard
          icon={TrendingUp}
          label="Credits earned"
          value={overview.totalEarned.toLocaleString()}
        />
        <StatCard
          icon={CheckCheck}
          label="Direct rate"
          value={tiers[0] ? bpsToPercent(tiers[0].rateBps) : '10%'}
        />
      </div>

      {/* Your unique link */}
      <section className="rounded-2xl border border-hairline bg-bg-1 p-5">
        <h2 className="mb-1 text-[14.5px] font-semibold tracking-[-0.01em]">Your unique link</h2>
        <p className="mb-4 text-[12.5px] text-fg-4">
          Share this link — anyone who joins through it is permanently tied to your account.
        </p>
        {referralUrl ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-[12.5px] text-fg-2">
              {referralUrl}
            </code>
            <Button
              type="button"
              variant={copied ? 'primary' : 'outline'}
              size="sm"
              icon={copied ? CheckCheck : Copy}
              onClick={copyLink}
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        ) : (
          <p className="text-[12.5px] text-danger">Could not generate your link — please refresh.</p>
        )}
      </section>

      {/* Invite by email */}
      <section className="rounded-2xl border border-hairline bg-bg-1 p-5">
        <h2 className="mb-1 text-[14.5px] font-semibold tracking-[-0.01em]">Invite by email</h2>
        <p className="mb-4 text-[12.5px] text-fg-4">
          Send a personal magic-link directly — the referral credit attaches automatically.
        </p>
        <form onSubmit={sendInvite} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Mail
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5"
              aria-hidden
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@fund.com"
              className="w-full rounded-xl border border-hairline bg-surface-1 py-2.5 pl-8 pr-3 text-[13px] text-fg-1 outline-none transition focus:border-azure-1"
            />
          </div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
        {error && (
          <p className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        )}
        {message && <p className="mt-3 text-[12.5px] text-gold-1">{message}</p>}
      </section>

      {/* Commission tiers */}
      {tiers.length > 0 && (
        <section className="rounded-2xl border border-hairline bg-bg-1 p-5">
          <h2 className="mb-1 text-[14.5px] font-semibold tracking-[-0.01em]">
            How commission works
          </h2>
          <p className="mb-4 text-[12.5px] text-fg-4">
            You earn a cut every time a referred member takes an approved Earn action. Rates are set
            by the platform and compound through tiers.
          </p>
          <div className="flex flex-col gap-2">
            {tiers.map((t) => (
              <div
                key={t.tier}
                className="flex items-center justify-between rounded-xl border border-hairline bg-surface-1 px-4 py-3"
              >
                <div className="text-[13px] font-medium text-fg-1">
                  Tier {t.tier}{' '}
                  <span className="text-[11.5px] font-normal text-fg-4">
                    {t.tier === 1 ? '· direct referral' : `· ${t.tier}x removed`}
                  </span>
                </div>
                <Badge tone="success">{bpsToPercent(t.rateBps)}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Referred members */}
      {overview.rows.length > 0 && (
        <section className="rounded-2xl border border-hairline bg-bg-1 p-5">
          <h2 className="mb-4 text-[14.5px] font-semibold tracking-[-0.01em]">
            Your referrals{' '}
            <span className="text-[13px] font-normal text-fg-4">· {overview.rows.length}</span>
          </h2>
          <div className="flex flex-col gap-2">
            {overview.rows.map((r) => (
              <div
                key={r.referredOrgId}
                className="flex items-center justify-between rounded-xl border border-hairline bg-surface-1 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-fg-1">
                    {r.referredName ?? 'Anonymous'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-5">
                    <span>Joined {relDate(r.joinedAt)}</span>
                    <span aria-hidden>·</span>
                    <span className="capitalize">{r.source.replace('_', ' ')}</span>
                  </div>
                </div>
                {r.creditsEarned > 0 && (
                  <span className="ml-3 shrink-0 text-[12.5px] font-semibold text-gold-1">
                    +{r.creditsEarned.toLocaleString()} cr
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3">
      <Icon size={16} strokeWidth={1.9} className="flex-none text-azure-1" aria-hidden />
      <div className="min-w-0">
        <div className="text-[17px] font-semibold tracking-[-0.01em] [font-feature-settings:'tnum']">
          {value}
        </div>
        <div className="truncate text-[10.5px] uppercase tracking-[0.08em] text-fg-5">{label}</div>
      </div>
    </div>
  );
}
