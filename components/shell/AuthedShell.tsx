import 'server-only';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getCreditWallet } from '@/lib/queries/credit-wallet';
import { getDashboardData } from '@/lib/queries/dashboard';
import { buildRailSignals } from '@/lib/dashboard-rail-signals';

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
 * Resolves the signed-in identity, the active org, the credit wallet, and the
 * lifecycle-aware rail signals (current stage + per-item badges) once per
 * request, then mounts `<AppShell>` with everything wired. Redirects to
 * `/login` when no session.
 *
 * The dashboard fetch here is shared with the Command Center page when both
 * render in the same request (Next caches identical loader calls). Pages that
 * have bespoke bootstrap (e.g. `/command-center`) keep using `<AppShell>`
 * directly so they can sequence loaders explicitly.
 *
 * The dashboard fetch degrades gracefully — any read error skips the rail
 * signals (rail renders without badges) rather than failing the whole shell.
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

  const [wallet, navSignals] = await Promise.all([
    getCreditWallet(org.orgId).catch(() => null),
    getDashboardData(org.orgId)
      .then((d) => buildRailSignals(d))
      .catch(() => undefined)
  ]);

  return (
    <AppShell
      title={title}
      subtitle={subtitle}
      identity={identity}
      wallet={wallet}
      navSignals={navSignals}
    >
      {children}
    </AppShell>
  );
}

export default AuthedShell;
