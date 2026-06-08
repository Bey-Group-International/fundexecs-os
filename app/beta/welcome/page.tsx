import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getInviteWelcome } from '@/lib/queries/invite-welcome';
import { WelcomeView } from './WelcomeView';

export const metadata: Metadata = { title: 'Welcome to the private beta' };

/**
 * Post-auth beta welcome. Email-invited users land here once their magic link
 * verifies (instead of dropping straight into onboarding): Earn greets them
 * personally, gives a quick cinematic intro + optional tour, then hands off to
 * /onboarding. Requires a session — the magic link already established one.
 */
export default async function BetaWelcomePage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();

  const invite = await getInviteWelcome(user.email);

  return (
    <WelcomeView
      name={profile?.full_name?.trim() || null}
      inviterName={invite?.inviterName ?? null}
    />
  );
}
