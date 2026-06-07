import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';

/* ============================================================================
 * lib/queries/public-profile.ts — the SAFE, token-gated public view.
 *
 * Resolves a shareable Profile link (/p/<token>) using the service-role admin
 * client on the public route. It validates the share token (exists, not
 * revoked, not expired) and returns ONLY a safe subset of the org's
 * Source-of-Truth profile. Sensitive fields — thesis, strategy, target raise,
 * terms (fee/carry), track record, team, bio, check size, contact details, and
 * any draft — are deliberately never read into this shape, so they cannot leak.
 * ========================================================================= */

export interface PublicProfile {
  /** Org / entity display name. */
  entityName: string;
  tier: string | null;
  memberType: MemberType | null;
  /** Human label for the member type. */
  memberLabel: string;
  /** Owner display name (member_profiles.display_name or profile full_name). */
  ownerName: string | null;
  headline: string | null;
  focusAreas: string[];
  /** High-level category select (firm type / service category / investor type). */
  category: string | null;
  sectors: string[];
  stageFocus: string[];
  website: string | null;
  linkedin: string | null;
}

type Details = Record<string, unknown>;

function str(details: Details, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = details[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function tagList(details: Details, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = details[k];
    if (Array.isArray(v)) {
      const out = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
      if (out.length > 0) return out;
    }
    // A select-style single value (e.g. startup `stage`) still reads as one tag.
    if (typeof v === 'string' && v.trim().length > 0) return [v.trim()];
  }
  return [];
}

function normHref(value: string | null): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * Resolve a public Profile by share token, or null when the token is missing,
 * unknown, revoked, or expired. Service-role read — never call from a context
 * that should be RLS-scoped.
 */
export async function getPublicProfile(token: string): Promise<PublicProfile | null> {
  if (!token || token.length < 16) return null;
  const admin = createAdminClient();

  const { data: share } = await admin
    .from('member_profile_shares')
    .select('org_id, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!share || share.revoked_at) return null;
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) return null;

  const orgId = share.org_id as string;

  const [{ data: org }, { data: members }] = await Promise.all([
    admin.from('organizations').select('name, tier').eq('id', orgId).maybeSingle(),
    admin
      .from('org_members')
      .select('user_id, role, created_at')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
  ]);

  const memberList = (members ?? []) as Array<{ user_id: string; role: string }>;
  const owner =
    memberList.find((m) => m.role === 'owner') ??
    memberList.find((m) => m.role === 'admin') ??
    memberList[0] ??
    null;

  let memberType: MemberType | null = null;
  let ownerName: string | null = null;
  let headline: string | null = null;
  let focusAreas: string[] = [];
  let details: Details = {};

  if (owner) {
    const [{ data: profile }, { data: mp }] = await Promise.all([
      admin.from('profiles').select('full_name, member_type').eq('id', owner.user_id).maybeSingle(),
      admin
        .from('member_profiles')
        .select('display_name, headline, focus_areas, details')
        .eq('user_id', owner.user_id)
        .maybeSingle()
    ]);
    memberType = (profile?.member_type ?? null) as MemberType | null;
    ownerName = (mp?.display_name ?? '').trim() || profile?.full_name || null;
    headline = mp?.headline?.trim() || null;
    focusAreas = ((mp?.focus_areas as string[] | null) ?? [])
      .map((f) => (typeof f === 'string' ? f.trim() : ''))
      .filter(Boolean);
    details = ((mp?.details as Details) ?? {}) as Details;
  }

  return {
    entityName: org?.name ?? 'A FundExecs member',
    tier: org?.tier ?? null,
    memberType,
    memberLabel: memberType ? MEMBER_TYPE_LABELS[memberType] : 'Member',
    ownerName,
    headline,
    focusAreas,
    category: str(details, 'firm_type', 'service_category', 'investor_profile'),
    sectors: tagList(details, 'sectors', 'sector'),
    stageFocus: tagList(details, 'stage_focus', 'stage'),
    website: normHref(str(details, 'website')),
    linkedin: normHref(str(details, 'linkedin'))
  };
}
