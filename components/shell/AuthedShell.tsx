import 'server-only';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { getActiveOrg } from '@/lib/queries/org';
import { getCreditWallet } from '@/lib/queries/credit-wallet';

export interface AuthedShellProps {
  title: string;
  subtitle?: string;
  /** Path the caller is on — used for the post-login redirect. */
  redirectFrom?: string;
  children: ReactNode;
}

/**
 * AuthedShell — server-async wrapper used by Wave-1 stub routes so each one
 * doesn't have to repeat the identity + org + wallet bootstrap. Resolves the
 * signed-in identity, the active org, and the credit wallet, then mounts
 * `<AppShell>` with everything wired. Redirects to `/login` when no session.
 *
 * Pages that already do their own bootstrap (e.g. `/command-center`) keep
 * using `<AppShell>` directly. This helper is just for the routes whose only
 * job is "render the shell + a placeholder."
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
  const wallet = org ? await getCreditWallet(org.orgId) : null;

  return (
    <AppShell title={title} subtitle={subtitle} identity={identity} wallet={wallet}>
      {children}
    </AppShell>
  );
}

export default AuthedShell;
