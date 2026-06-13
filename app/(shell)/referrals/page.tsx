import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { getActiveOrg } from '@/lib/queries/org';
import { getReferralOverview, getReferralTiers } from '@/lib/queries/referrals';
import { getOrCreateReferralCode } from '@/lib/actions/referral-code';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteURL } from '@/lib/site-url';
import { ReferralPanel } from './ReferralPanel';

export const metadata: Metadata = {
  title: 'Refer & Invite',
  description: 'Invite peers to FundExecs OS and earn commission credits on every action they take.'
};

export const dynamic = 'force-dynamic';

export default async function ReferralsPage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const admin = createAdminClient();
  const [code, overview, tiers] = await Promise.all([
    getOrCreateReferralCode(admin, org.userId, org.orgId),
    getReferralOverview(org.orgId),
    getReferralTiers()
  ]);

  const referralUrl = code ? `${getSiteURL()}/ref/${code}` : null;

  return (
    <div className="fx-rise mx-auto max-w-[760px]">
      <div className="mb-6 flex items-start gap-3">
        <EarnCoin size={40} online className="flex-none" />
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-fg-1">Refer &amp; Invite</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-4">
            Invite peers to FundExecs OS — earn commission credits every time they take an approved
            action.
          </p>
        </div>
      </div>

      <ReferralPanel
        referralUrl={referralUrl}
        code={code}
        overview={overview}
        tiers={tiers}
      />
    </div>
  );
}
