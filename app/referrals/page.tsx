import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { Card } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getReferralOverview } from '@/lib/queries/referrals';
import { getOrCreateReferralCode } from '@/lib/actions/referral-code';
import { getSiteURL } from '@/lib/site-url';
import { ReferralsView } from './ReferralsView';

export const metadata: Metadata = { title: 'Referrals' };

export const dynamic = 'force-dynamic';

/**
 * /referrals — the operator's personal affiliate hub.
 *
 * Every user gets a sharable link (`/r/<code>`). When someone they refer builds
 * their own workspace and buys credits, the user earns a 10% commission. This
 * page surfaces their link, lifetime earnings, and who they've brought in.
 *
 * A user's own org is their `referrer_org_id`, so we reuse the same
 * `getReferralOverview(orgId)` loader the admin panel uses.
 */
export default async function ReferralsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectedFrom=%2Freferrals');

  const [identity, org] = await Promise.all([getShellIdentity(), getActiveOrg()]);

  if (!org) {
    return (
      <AppShell title="Referrals" subtitle="Earn credits" identity={identity}>
        <Card className="p-8 text-center">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-fg-4">
            No workspace yet
          </p>
          <p className="mt-2 text-[13px] text-fg-2">
            Your workspace is being set up. Refresh in a moment to grab your referral link.
          </p>
        </Card>
      </AppShell>
    );
  }

  const admin = createAdminClient();
  const [overview, wallet, code] = await Promise.all([
    getReferralOverview(org.orgId),
    getCreditWallet(org.orgId),
    getOrCreateReferralCode(admin, org.userId, org.orgId)
  ]);

  const referralUrl = code ? `${getSiteURL()}/ref/${code}` : null;

  return (
    <AppShell title="Referrals" subtitle="Earn credits" identity={identity} wallet={wallet}>
      <ReferralsView overview={overview} referralUrl={referralUrl} />
    </AppShell>
  );
}
