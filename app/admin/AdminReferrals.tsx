import { TrendingUp, Users } from 'lucide-react';
import type { ReferralOverview } from '@/lib/queries/referrals';

function relDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const SOURCE_LABEL: Record<string, string> = {
  beta_link: 'Referral link',
  beta_invite: 'Email invite',
  peer: 'Peer referral'
};

export function AdminReferrals({ referrals }: { referrals: ReferralOverview | null }) {
  if (!referrals) {
    return (
      <div className="rounded-2xl border border-hairline bg-bg-1 px-6 py-10 text-center text-[13px] text-fg-4">
        No referral data available.
      </div>
    );
  }

  const { rows, totalEarned, referredCount } = referrals;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { icon: Users, label: 'Total referred', value: String(referredCount) },
          {
            icon: TrendingUp,
            label: 'Total commission credits',
            value: totalEarned.toLocaleString()
          }
        ].map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-2xl border border-hairline bg-bg-1 px-4 py-4"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
              <Icon size={15} aria-hidden />
            </span>
            <div>
              <div className="text-[18px] font-semibold tracking-tight text-fg-1">{value}</div>
              <div className="text-[11.5px] text-fg-4">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-hairline bg-bg-1 px-6 py-10 text-center text-[13px] text-fg-4">
          No referrals recorded yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-hairline bg-bg-1 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-0 border-b border-hairline px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-4">
            <span>Member</span>
            <span className="px-4 text-right">Source</span>
            <span className="px-4 text-right">Joined</span>
            <span className="text-right">Credits</span>
          </div>
          <ul>
            {rows.map((r, i) => (
              <li
                key={r.referredOrgId}
                className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-0 px-5 py-3 text-[13px] ${
                  i < rows.length - 1 ? 'border-b border-hairline' : ''
                }`}
              >
                <span className="font-medium text-fg-1">{r.referredName ?? 'Anonymous'}</span>
                <span className="px-4 text-right text-[12px] text-fg-4">
                  {SOURCE_LABEL[r.source] ?? r.source}
                </span>
                <span className="px-4 text-right text-[12px] text-fg-5">{relDate(r.joinedAt)}</span>
                <span className="text-right text-[12.5px] font-semibold text-gold-1">
                  {r.creditsEarned > 0 ? `+${r.creditsEarned.toLocaleString()}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
