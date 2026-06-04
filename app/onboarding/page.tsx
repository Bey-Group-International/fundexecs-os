import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { OnboardingView } from './OnboardingView';

export const metadata: Metadata = { title: 'Welcome to FundExecs OS' };

/**
 * Onboarding — a focused, full-screen 4-step stepper (Identity → Role →
 * Socials → Review). Pre-fills the signed-in identity; the client view writes
 * `profiles.role` (and creates an org if needed) on finish, then routes to the
 * Command Center.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const org = await getActiveOrg();

  let fullName: string | null = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    fullName = data?.full_name ?? null;
  }

  return (
    <OnboardingView email={user?.email ?? ''} fullName={fullName ?? ''} hasOrg={org != null} />
  );
}
