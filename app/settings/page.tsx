import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { SettingsView } from './SettingsView';

export const metadata: Metadata = { title: 'Profile & settings' };

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

  const org = await getActiveOrg();

  let orgName: string | null = null;
  let orgTier: string | null = null;
  if (org) {
    const { data } = await supabase
      .from('organizations')
      .select('name, tier')
      .eq('id', org.orgId)
      .maybeSingle();
    orgName = data?.name ?? null;
    orgTier = data?.tier ?? null;
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
      />
    </AppShell>
  );
}
