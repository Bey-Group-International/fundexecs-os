import { createClient } from '@/lib/supabase/server';
import type { MemberType } from '@/lib/member-types';

/**
 * The Proof of Truth profile Earn assembles for the signed-in user. `details`
 * holds member-type-specific fields; `draft` holds the in-progress Q&A answers
 * so an unfinished profile can be resumed.
 */
export interface MemberProfile {
  userId: string;
  /** From `profiles.member_type`; null until the user picks a type. */
  memberType: MemberType | null;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  focusAreas: string[];
  links: Record<string, string>;
  details: Record<string, unknown>;
  draft: Record<string, unknown>;
  status: 'in_progress' | 'complete';
  completionPct: number;
}

/**
 * Resolve the signed-in user's member profile, merging `profiles.member_type`
 * with the `member_profiles` row. Returns a blank (in-progress) profile when no
 * row exists yet, or `null` when there is no authenticated user.
 */
export async function getMemberProfile(): Promise<MemberProfile | null> {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: mp }] = await Promise.all([
    supabase.from('profiles').select('member_type').eq('id', user.id).maybeSingle(),
    supabase.from('member_profiles').select('*').eq('user_id', user.id).maybeSingle()
  ]);

  const memberType = (profile?.member_type ?? null) as MemberType | null;

  if (!mp) {
    return {
      userId: user.id,
      memberType,
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
  }

  return {
    userId: user.id,
    memberType,
    displayName: mp.display_name,
    headline: mp.headline,
    bio: mp.bio,
    focusAreas: mp.focus_areas ?? [],
    links: (mp.links as Record<string, string>) ?? {},
    details: (mp.details as Record<string, unknown>) ?? {},
    draft: (mp.draft as Record<string, unknown>) ?? {},
    status: mp.status === 'complete' ? 'complete' : 'in_progress',
    completionPct: mp.completion_pct
  };
}
