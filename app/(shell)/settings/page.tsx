import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsFlow } from '@/components/settings/SettingsFlow';
import { mergeConnections } from '@/lib/integrations/catalog';
import {
  getIntegrationAccessRequests,
  getIntegrationConnections
} from '@/lib/queries/integrations';
import { getOrgTeam } from '@/lib/queries/org-members';
import { getActiveOrg } from '@/lib/queries/org';
import { getAccountProfile, getWorkspaceProfile } from '@/lib/queries/settings';
import { oauthBanner, resolveSettingsTab } from '@/lib/settings/vocabulary';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Your account, your workspace, and the systems Earn works through.'
};

/**
 * /settings — the last "Soon" in the shell, live. Account over `profiles`,
 * Workspace over `organizations` + `org_members` (owner/admin actions are
 * RLS-gated), Integrations over `integration_connections` and the full
 * provider catalog. One load, three sections.
 */
export default async function SettingsPage({
  searchParams
}: {
  searchParams: Promise<{ tab?: string; connected?: string; error?: string }>;
}) {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const params = await searchParams;

  const [account, workspace, team, connections, accessRequests] = await Promise.all([
    getAccountProfile(org.userId),
    getWorkspaceProfile(org.orgId),
    getOrgTeam(org.orgId, org.userId),
    getIntegrationConnections(org.orgId, org.userId),
    getIntegrationAccessRequests(org.orgId, org.userId)
  ]);

  const banner = oauthBanner(params.connected, params.error);
  // An OAuth round-trip lands with ?connected/?error — open on Integrations so
  // the banner is visible without a tab hunt.
  const initialTab =
    params.tab === undefined && banner ? 'integrations' : resolveSettingsTab(params.tab);

  return (
    <div className="fx-rise mx-auto max-w-[860px]">
      <SettingsFlow
        initialTab={initialTab}
        viewerUserId={org.userId}
        account={account ?? { name: '', role: '', email: null, avatarUrl: null }}
        workspace={workspace}
        team={team}
        integrations={mergeConnections(connections, accessRequests)}
        banner={banner}
      />
    </div>
  );
}
