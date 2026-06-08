'use client';

import { Coins, Users, TrendingUp, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import type { ReferralOverview, ReferralRow } from '@/lib/queries/referrals';

/** How each referral source reads in the table — link, per-email invite, or a
 *  user's own peer referral. */
const SOURCE_META: Record<ReferralRow['source'], { tone: BadgeTone; label: string }> = {
  beta_link: { tone: 'neutral', label: 'Link' },
  beta_invite: { tone: 'gold', label: 'Invite' },
  peer: { tone: 'azure', label: 'Referral' }
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

/**
 * Admin Referrals panel — the affiliate picture for this org as a referrer.
 * Surfaces total commission earned, who was brought in, and per-referral
 * earnings. Credits are granted automatically by the Stripe webhook; this is the
 * visible ledger.
 */
export function ReferralsPanel({ overview }: { overview: ReferralOverview | null }) {
  const data = overview ?? { totalEarned: 0, referredCount: 0, rows: [], earningsBySource: {} };
  const earning = data.rows.filter((r) => r.creditsEarned > 0).length;

  return (
    <div className="flex flex-col gap-[18px]">
      <Card>
        <SectionTitle
          eyebrow="Affiliate"
          title="Referral earnings"
          className="mb-3"
          action={<span className="text-[11px] text-fg-5">10% of referred purchases</span>}
        />
        <p className="mb-4 max-w-prose text-[12.5px] leading-relaxed text-fg-3">
          When someone you invited builds their own workspace and buys Earn credits, you earn{' '}
          <span className="font-medium text-fg-2">10% of those credits</span> — automatically, on
          every purchase. Here&apos;s who you&apos;ve brought in and what they&apos;ve earned you.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Stat icon={Coins} label="Credits earned" value={data.totalEarned.toLocaleString()} />
          <Stat icon={Users} label="People referred" value={String(data.referredCount)} />
          <Stat icon={TrendingUp} label="Now earning" value={String(earning)} />
        </div>
      </Card>

      <Card className="p-2">
        <div className="grid grid-cols-[1.9fr_0.7fr_0.9fr_0.8fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          <span>Referred</span>
          <span>Via</span>
          <span>Joined</span>
          <span className="text-right">Earned</span>
        </div>
        <div className="h-px bg-hairline" />
        {data.rows.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-fg-5">
            No referrals yet. Invite founders from the Beta invites tab — once they join and buy
            credits, your commission lands here.
          </div>
        ) : (
          data.rows.map((r) => (
            <div
              key={r.referredOrgId}
              className="grid grid-cols-[1.9fr_0.7fr_0.9fr_0.8fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-fg-1">
                  {r.referredName || 'New member'}
                </div>
                {r.lastRewardAt && (
                  <div className="truncate text-[11px] text-fg-5">
                    Last earned {relativeTime(r.lastRewardAt)}
                  </div>
                )}
              </div>
              <div>
                <Badge tone={SOURCE_META[r.source].tone} className="text-[10px]">
                  {SOURCE_META[r.source].label}
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
          ))
        )}
      </Card>
    </div>
  );
}

export default ReferralsPanel;
