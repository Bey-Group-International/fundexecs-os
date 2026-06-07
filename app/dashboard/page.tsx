import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/queries/auth';

export const metadata: Metadata = {
  title: { absolute: 'FundExecs OS — Dashboard' },
  description: 'Your fund command center — the lifecycle-aware home for every operator.'
};

/**
 * Legacy route. The authenticated home is the Command Center — redirect there
 * (or to login if unauthenticated) so old `/dashboard` links never dead-end on
 * a stale stub. Uses the edge-validated `getAuthUser` (a serverless
 * `getUser()` returns null here even on a valid session, which would wrongly
 * bounce signed-in users to /login).
 */
export default async function DashboardPage() {
  const user = await getAuthUser();
  redirect(user ? '/command-center' : '/login');
}
