import 'server-only';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getDashboardData } from '@/lib/queries/dashboard';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';
import { ProfileRailSummary, ProfileRailSummaryEmpty } from '@/components/profile';

export interface AuthedShellProps {
  title: string;
  subtitle?: string;
  /** Path the caller is on — used for the post-login redirect. */
  redirectFrom?: string;
  children: ReactNode;
}

/**
 * AuthedShell — server-async wrapper used by Wave-1 stub routes so each one
 * doesn't have to repeat the identity + org + wallet + rail-signals bootstrap.
 * Resolves the signed-in identity, the active org, the credit wallet, the
 * lifecycle-aware rail signals (current stage + per-item badges), and the
 * Source-of-Truth fund-profile summary once per request, then mounts
 * `<AppShell>` with everything wired. Redirects to `/login` when no session.
 *
 * The dashboard + fund-profile fetches here are shared with bespoke pages that
 * use the same loaders (Next caches identical loader calls per request).
 *
 * Every read here degrades gracefully — any failure simply skips that piece
 * (rail without badges, no source-of-truth summary, no wallet) rather than
 * failing the whole shell.
 */
export async function AuthedShell({
  title,
  subtitle,
  redirectFrom = '/',
  children
}: AuthedShellProps) {
  const identity = await getShellIdentity();
  if (!identity) {
    redirect(`/login?redirectedFrom=${encodeURIComponent(redirectFrom)}`);
  }

  const org = await getActiveOrg();
  if (!org) {
    return (
      <AppShell title={title} subtitle={subtitle} identity={identity}>
        {children}
      </AppShell>
    );
  }

  const [wallet, navSignals, fundProfile] = await Promise.all([
    getCreditWallet(org.orgId).catch(() => null),
    getDashboardData(org.orgId)
      .then((d) => buildRailSignals(d))
      .catch(() => undefined),
    getFundProfile(org.orgId).catch(() => null)
  ]);

  const sourceOfTruthSummary = fundProfile ? (
    <ProfileRailSummary profile={fundProfile} />
  ) : (
    <ProfileRailSummaryEmpty />
  );

  return (
    <AppShell
      title={title}
      subtitle={subtitle}
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
      sourceOfTruthSummary={sourceOfTruthSummary}
    >
      {children}
    </AppShell>
  );
}

export default AuthedShell;
