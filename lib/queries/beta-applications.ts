import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/lib/access.server';
import { isMemberType, type MemberType } from '@/lib/member-types';

export type ApplicationReview = 'pending' | 'approved' | 'rejected';

export interface BetaApplication {
  /** beta_link_claims.id — the row the review status hangs off. */
  claimId: string;
  userId: string;
  email: string;
  /** Captured in the welcome flow (or the member's profile name). */
  name: string | null;
  memberType: MemberType | null;
  /** The one-line "what you want" answer, if they gave one. */
  goal: string | null;
  /** Label of the link they came through (e.g. "Wave 2 LPs"). */
  linkLabel: string | null;
  claimedAt: string;
  review: ApplicationReview;
  reviewedAt: string | null;
}

function normalizeReview(value: unknown): ApplicationReview {
  return value === 'approved' || value === 'rejected' ? value : 'pending';
}

/** Pull a trimmed string field out of the member_profiles.draft JSON blob. */
function draftString(draft: unknown, key: string): string | null {
  if (!draft || typeof draft !== 'object') return null;
  const value = (draft as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The Applications inbox: everyone who claimed a shareable beta link for this
 * org, enriched with what they told Earn in the welcome flow (name, member type,
 * goal) and the link they came through. Newest claim first.
 *
 * Reads with the service-role client because the captured goal lives in
 * `member_profiles.draft` (not readable cross-member under RLS) — so the
 * function self-gates on platform admin and scopes every read to `orgId`. The
 * settings loader only calls it for the Bey Group team, this is belt-and-braces.
 * Degrades to an empty list on any failure so the admin portal still renders.
 */
export async function getBetaApplications(orgId: string): Promise<BetaApplication[]> {
  if (!orgId) return [];
  if (!(await requirePlatformAdmin())) return [];

  const admin = createAdminClient();

  const { data: claims, error } = await admin
    .from('beta_link_claims')
    .select('id, beta_link_id, user_id, email, claimed_at, review_status, reviewed_at')
    .eq('org_id', orgId)
    .order('claimed_at', { ascending: false });

  if (error || !claims || claims.length === 0) return [];

  const linkIds = [...new Set(claims.map((c) => c.beta_link_id))];
  const userIds = [...new Set(claims.map((c) => c.user_id))];

  const [
    { data: links, error: linksErr },
    { data: profiles, error: profilesErr },
    { data: memberProfiles, error: memberProfilesErr }
  ] = await Promise.all([
    admin.from('beta_links').select('id, label').in('id', linkIds),
    admin.from('profiles').select('id, full_name, member_type').in('id', userIds),
    admin.from('member_profiles').select('user_id, draft').in('user_id', userIds)
  ]);
  // Fail closed: a partial enrichment would render misleading cards (missing
  // names/goals), so drop the whole list rather than show half-built ones.
  if (linksErr || profilesErr || memberProfilesErr) return [];

  const labelById = new Map((links ?? []).map((l) => [l.id, l.label]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const draftByUser = new Map((memberProfiles ?? []).map((m) => [m.user_id, m.draft]));

  const enriched = claims.map((c) => {
    const profile = profileById.get(c.user_id);
    const draft = draftByUser.get(c.user_id);
    const name = profile?.full_name?.trim() || draftString(draft, 'name');
    const memberType = isMemberType(profile?.member_type) ? profile.member_type : null;
    return {
      claimId: c.id,
      userId: c.user_id,
      email: c.email,
      name: name || null,
      memberType,
      goal: draftString(draft, 'goal'),
      linkLabel: labelById.get(c.beta_link_id) ?? null,
      claimedAt: c.claimed_at,
      review: normalizeReview(c.review_status),
      reviewedAt: c.reviewed_at
    };
  });

  // Surface the worklist: pending first (what needs action), then approved, then
  // rejected. Within each group the DB's newest-first order is preserved (the
  // sort is stable), so the inbox reads as a triage queue, not a flat log.
  const rank: Record<ApplicationReview, number> = { pending: 0, approved: 1, rejected: 2 };
  return enriched.sort((a, b) => rank[a.review] - rank[b.review]);
}
