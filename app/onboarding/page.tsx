import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { OnboardingFlow } from './OnboardingFlow';

export const metadata: Metadata = { title: 'Brief your team' };

/**
 * Onboarding — the Mandate Brief. A short, role-aware wizard that reframes
 * "make your profile" as "brief your executive team", then plays the team
 * activation and lands the member in their command center. Pre-fills the
 * signed-in identity.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirectedFrom=/onboarding');

  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();

  return <OnboardingFlow initialName={data?.full_name ?? ''} />;
}
