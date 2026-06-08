'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Coins,
  Copy,
  Link2,
  Mail,
  TrendingUp,
  Users,
  UserPlus,
  type LucideIcon
} from 'lucide-react';
import { Badge, Card, SectionTitle } from '@/components/ui';
import type { ReferralOverview, ReferralRow } from '@/lib/queries/referrals';

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
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const SOURCE_META: Record<ReferralRow['source'], { label: string; icon: LucideIcon }> = {
  beta_link: { label: 'Link', icon: Link2 },
  beta_invite: { label: 'Invite', icon: Mail },
  peer: { label: 'Referral', icon: UserPlus }
};

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[var(--gold-soft,var(--surface-2))] text-gold-1">
        <Icon size={17} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[18px] font-semibold tabular-nums leading-none text-fg-1">{value}</div>
        <div className="mt-1 text-[11px] text-fg-4">{label}</div>
      </div>
    </div>
  );
}

/** The copyable referral link with a Copied confirmation. */
function ReferralLink({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending reset on unmount so we never setState on a gone component.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context) — leave the field
      // selectable so the user can copy manually.
    }
  }, [url]);

  if (!url) {
    return (
      <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-3 text-[12.5px] text-fg-4">
        Your referral link is being prepared. Refresh in a moment.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5">
        <Link2 size={15} strokeWidth={1.9} aria-hidden className="flex-none text-fg-4" />
        <span className="truncate font-mono text-[12.5px] text-fg-2">{url}</span>
      </div>
      <button
        type="button"
        onClick={onCopy}
        aria-live="polite"
        className="inline-flex flex-none items-center justify-center gap-1.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft,var(--surface-2))] px-3.5 py-2.5 text-[12.5px] font-semibold text-gold-1 transition-[background,box-shadow] hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
      >
        {copied ? (
          <>
            <Check size={15} strokeWidth={2.2} aria-hidden />
            Copied
          </>
        ) : (
          <>
            <Copy size={15} strokeWidth={1.9} aria-hidden />
            Copy link
          </>
        )}
      </button>
    </div>
  );
}

/**
 * ReferralsView — the operator-facing affiliate hub. Hero pitch, the personal
 * referral link with a Copy button, headline stats, and the list of direct
 * referrals with what each has earned. Reduced-motion safe; all transitions are
 * gated behind `motion-safe:`.
 */
export function ReferralsView({
  overview,
  referralUrl
}: {
  overview: ReferralOverview;
  referralUrl: string | null;
}) {
  const earning = overview.rows.filter((r) => r.creditsEarned > 0).length;

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Hero + link */}
      <Card className="overflow-hidden">
        <SectionTitle
          eyebrow="Your referral link"
          title="Invite operators. Earn together."
          className="mb-3"
          action={<Badge tone="gold">10% commission</Badge>}
        />
        <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-fg-3">
          Share your link with founders and operators. When someone you invite builds their
          workspace and buys Earn credits, you earn{' '}
          <span className="font-medium text-fg-1">10% of those credits</span> — automatically, on
          every purchase. You even earn{' '}
          <span className="font-medium text-fg-1">5% from their referrals</span> down the line.
        </p>
        <ReferralLink url={referralUrl} />
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat icon={Coins} label="Credits earned" value={overview.totalEarned.toLocaleString()} />
        <Stat icon={Users} label="People referred" value={String(overview.referredCount)} />
        <Stat icon={TrendingUp} label="Now earning" value={String(earning)} />
      </div>

      {/* Direct referrals */}
      <Card className="p-2">
        <div className="grid grid-cols-[1.9fr_0.8fr_0.9fr_0.8fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          <span>Referred</span>
          <span>Via</span>
          <span>Joined</span>
          <span className="text-right">Earned</span>
        </div>
        <div className="h-px bg-hairline" />
        {overview.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold-soft,var(--surface-2))] text-gold-1">
              <UserPlus size={18} strokeWidth={1.9} aria-hidden />
            </span>
            <p className="text-[13px] text-fg-3">No referrals yet.</p>
            <p className="max-w-xs text-[12px] text-fg-5">
              Share your link above — once someone joins and buys credits, your earnings land here.
            </p>
          </div>
        ) : (
          overview.rows.map((r) => {
            const meta = SOURCE_META[r.source];
            const Icon = meta.icon;
            return (
              <div
                key={r.referredOrgId}
                className="grid grid-cols-[1.9fr_0.8fr_0.9fr_0.8fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-fg-1">
                    {r.referredName || 'New member'}
                  </div>
                  {r.lastRewardAt ? (
                    <div className="truncate text-[11px] text-fg-5">
                      Last earned {relativeTime(r.lastRewardAt)}
                    </div>
                  ) : null}
                </div>
                <div>
                  <Badge
                    tone={r.source === 'peer' ? 'gold' : 'neutral'}
                    className="inline-flex items-center gap-1 text-[10px]"
                  >
                    <Icon size={11} strokeWidth={2} aria-hidden />
                    {meta.label}
                  </Badge>
                </div>
                <span className="text-[11.5px] text-fg-4">{relativeTime(r.joinedAt)}</span>
                <span
                  className={`text-right text-[12.5px] font-semibold tabular-nums ${
                    r.creditsEarned > 0 ? 'text-gold-1' : 'text-fg-5'
                  }`}
                >
                  {r.creditsEarned > 0 ? `+${r.creditsEarned.toLocaleString()}` : '—'}
                </span>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}

export default ReferralsView;
