import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile } from '@/lib/queries/member-profile';
import type { Database } from '@/lib/supabase/database.types';
import { SettingsView } from './SettingsView';

export const metadata: Metadata = { title: 'Profile & settings' };

type OrgType = Database['public']['Enums']['org_type'];

/**
 * Profile & settings — gamification header plus account / notifications /
 * security / organization / billing sections. The signed-in email and active
 * org are resolved on the server; everything else is presentational.
 */
export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [org, memberProfile] = await Promise.all([getActiveOrg(), getMemberProfile()]);

  let orgName: string | null = null;
  let orgTier: string | null = null;
  let orgType: OrgType | null = null;
  if (org) {
    const { data } = await supabase
      .from('organizations')
      .select('name, tier, type')
      .eq('id', org.orgId)
      .maybeSingle();
    orgName = data?.name ?? null;
    orgTier = data?.tier ?? null;
    orgType = data?.type ?? null;
  }

  let fullName: string | null = null;
  let role: string | null = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', user.id)
      .maybeSingle();
    fullName = data?.full_name ?? null;
    role = data?.role ?? null;
  }

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Profile & settings"
      subtitle="Your account, organization, and trust profile"
    >
      <SettingsView
        email={user?.email ?? null}
        fullName={fullName}
        role={role}
        orgName={orgName}
        orgTier={orgTier}
        orgType={orgType}
        bio={memberProfile?.bio ?? null}
        phone={
          typeof memberProfile?.details.contact_phone === 'string'
            ? memberProfile.details.contact_phone
            : null
        }
        proofStatus={memberProfile?.status ?? 'in_progress'}
        proofPct={memberProfile?.completionPct ?? 0}
        proofMemberType={memberProfile?.memberType ?? null}
      />
    </AppShell>
  );
}
