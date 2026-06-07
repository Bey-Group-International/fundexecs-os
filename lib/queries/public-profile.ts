import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';

/* ============================================================================
 * lib/queries/public-profile.ts — the SAFE, token-gated public view.
 *
 * Resolves a shareable Profile link (/p/<token>) using the service-role admin
 * client on the public route. It validates the share token (exists, not
 * revoked, not expired) and returns ONLY a safe subset of the org's
 * Source-of-Truth profile.
 *
 * Defense in depth: rather than reading the whole `member_profiles.details`
 * JSON and picking fields in JS, the query PROJECTS only the safe keys
 * (firm_type, sectors, stage, website, linkedin, …). Sensitive keys — thesis,
 * strategy, target raise, terms (fee/carry), track record, team, bio, check
 * size, contact — are never selected, so they never enter this execution path.
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

/** Shape of the projected (safe-keys-only) member_profiles select. */
interface SafeMemberRow {
  display_name: string | null;
  headline: string | null;
  focus_areas: string[] | null;
  firm_type: string | null;
  service_category: string | null;
  investor_profile: string | null;
  website: string | null;
  linkedin: string | null;
  sectors: unknown;
  sector: unknown;
  stage_focus: unknown;
  stage: string | null;
}

/** Trimmed non-empty string, or null. */
function cleanStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Coerce a JSON value to a string[] — array of strings, or a single string. */
function strArr(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  }
  const single = cleanStr(value);
  return single ? [single] : [];
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
  let category: string | null = null;
  let sectors: string[] = [];
  let stageFocus: string[] = [];
  let website: string | null = null;
  let linkedin: string | null = null;

  if (owner) {
    const [{ data: profile }, { data: mpRaw }] = await Promise.all([
      admin.from('profiles').select('full_name, member_type').eq('id', owner.user_id).maybeSingle(),
      admin
        .from('member_profiles')
        // Project ONLY safe keys out of the details JSON — sensitive keys are
        // never selected, so they can't leak onto the public route.
        .select(
          'display_name, headline, focus_areas, ' +
            'firm_type:details->>firm_type, service_category:details->>service_category, ' +
            'investor_profile:details->>investor_profile, website:details->>website, ' +
            'linkedin:details->>linkedin, sectors:details->sectors, sector:details->sector, ' +
            'stage_focus:details->stage_focus, stage:details->>stage'
        )
        .eq('user_id', owner.user_id)
        .maybeSingle()
    ]);

    const mp = mpRaw as unknown as SafeMemberRow | null;
    memberType = (profile?.member_type ?? null) as MemberType | null;
    ownerName = (mp?.display_name ?? '').trim() || profile?.full_name || null;
    headline = cleanStr(mp?.headline);
    focusAreas = strArr(mp?.focus_areas);
    category =
      cleanStr(mp?.firm_type) ?? cleanStr(mp?.service_category) ?? cleanStr(mp?.investor_profile);
    sectors = strArr(mp?.sectors).length > 0 ? strArr(mp?.sectors) : strArr(mp?.sector);
    stageFocus = strArr(mp?.stage_focus).length > 0 ? strArr(mp?.stage_focus) : strArr(mp?.stage);
    website = normHref(cleanStr(mp?.website));
    linkedin = normHref(cleanStr(mp?.linkedin));
  }

  return {
    entityName: org?.name ?? 'A FundExecs member',
    tier: org?.tier ?? null,
    memberType,
    memberLabel: memberType ? MEMBER_TYPE_LABELS[memberType] : 'Member',
    ownerName,
    headline,
    focusAreas,
    category,
    sectors,
    stageFocus,
    website,
    linkedin
  };
}
