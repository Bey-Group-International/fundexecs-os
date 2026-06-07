import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getMemberProfile, type MemberProfile } from '@/lib/queries/member-profile';
import { OnboardingView } from './OnboardingView';

export const metadata: Metadata = { title: 'Welcome to FundExecs OS' };

/** A blank in-progress profile, used when there is no row/user yet. */
const EMPTY_PROFILE: MemberProfile = {
  userId: '',
  memberType: null,
  displayName: null,
  headline: null,
  bio: null,
  focusAreas: [],
  links: {},
  details: {},
  draft: {},
  status: 'in_progress',
  completionPct: 0
};

/**
 * Onboarding — captures identity + organization, then hands off into the
 * conversational Proof of Truth flow where Earn builds the member's verified,
 * member-type-specific profile. Pre-fills the signed-in identity and seeds the
 * flow from any saved `draft` so it resumes.
 *
 * A `?focus=<questionId>` param (used by the Profile's "close gap" deep-links)
 * jumps the Q&A straight to that field. In Next 16 `searchParams` is async.
 */
export default async function OnboardingPage({
  searchParams
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  const supabase = await createClient();

  const { focus: rawFocus } = await searchParams;
  const focusField = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [org, profile] = await Promise.all([getActiveOrg(), getMemberProfile()]);

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
    <OnboardingView
      email={user?.email ?? ''}
      fullName={fullName ?? ''}
      hasOrg={org != null}
      profile={profile ?? EMPTY_PROFILE}
      focusField={focusField}
    />
  );
}
