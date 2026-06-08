import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';

/* ============================================================================
 * lib/queries/public-raise.ts — the SAFE, token-gated public raise page view.
 *
 * Resolves a published raise page (/r/<token>) using the service-role admin
 * client on the public route. It validates the share token (exists, not
 * revoked, not expired) and returns ONLY a safe subset:
 *
 *   - org name + owner display name + member-type label
 *   - the owner-authored title / headline
 *   - raise MOMENTUM expressed as percentages (committed %, coverage %)
 *   - absolute $ amounts ONLY when the owner opted in (`show_amounts`)
 *   - min check (display-only), interest count (social proof), Chain-of-Trust %
 *
 * Sensitive fund data — thesis, strategy, fee/carry terms, track record, team,
 * cap table — is never selected, so it can never enter this execution path.
 * All reads here go through the admin client; never call from an RLS-scoped
 * context.
 * ========================================================================= */

export interface PublicRaise {
  entityName: string;
  ownerName: string | null;
  memberType: MemberType | null;
  memberLabel: string;
  /** Owner-authored title; falls back to the org name in the UI. */
  title: string | null;
  headline: string | null;
  /** committed / target, 0–100 (0 when unsized). */
  committedPct: number;
  /** (committed + soft-circled) / target, 0–100 (0 when unsized). */
  coveragePct: number;
  /** Whether the owner opted to expose absolute dollar figures. */
  showAmounts: boolean;
  /** Dollar figures — null unless `showAmounts`. */
  target: number | null;
  committed: number | null;
  softCircled: number | null;
  /** Smallest indicative check, display-only. Null = unset. */
  minCheck: number | null;
  /** Count of inbound "express interest" submissions (social proof). */
  interestCount: number;
  /** Average Chain-of-Trust completion across the org's records, 0–100. */
  trustPct: number;
}

function pctOf(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((n / total) * 100));
}

/**
 * Resolve a public raise page by share token, or null when the token is
 * missing, unknown, revoked, or expired. Service-role read.
 */
export async function getPublicRaise(token: string): Promise<PublicRaise | null> {
  if (!token || token.length < 16) return null;
  const admin = createAdminClient();

  const { data: page } = await admin
    .from('raise_pages')
    .select('id, org_id, title, headline, min_check, show_amounts, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (!page || page.revoked_at) return null;
  if (page.expires_at && new Date(page.expires_at).getTime() <= Date.now()) return null;

  const orgId = page.org_id as string;
  const showAmounts = Boolean(page.show_amounts);

  const [{ data: org }, { data: members }, summaryRes, { count: interestCount }, { data: cot }] =
    await Promise.all([
      admin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
      admin
        .from('org_members')
        .select('user_id, role, created_at')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .order('created_at', { ascending: true }),
      admin.rpc('capital_stack_summary', { _org_id: orgId }),
      admin
        .from('raise_interests')
        .select('id', { count: 'exact', head: true })
        .eq('raise_page_id', page.id),
      admin.from('chain_of_trust_records').select('completion_percentage').eq('org_id', orgId)
    ]);

  // Raise momentum from the capital-stack rollup (same RPC the in-app bar uses).
  const summaryRow = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
  const target = Number(summaryRow?.target_total ?? 0);
  const softCircled = Number(summaryRow?.soft_circle_total ?? 0);
  const committed =
    Number(summaryRow?.committed_total ?? 0) + Number(summaryRow?.closed_total ?? 0);

  // Owner display name (safe): prefer the owner/admin member's profile name.
  const memberList = (members ?? []) as Array<{ user_id: string; role: string }>;
  const owner =
    memberList.find((m) => m.role === 'owner') ??
    memberList.find((m) => m.role === 'admin') ??
    memberList[0] ??
    null;

  let memberType: MemberType | null = null;
  let ownerName: string | null = null;
  if (owner) {
    const [{ data: profile }, { data: mp }] = await Promise.all([
      admin.from('profiles').select('full_name, member_type').eq('id', owner.user_id).maybeSingle(),
      admin
        .from('member_profiles')
        .select('display_name')
        .eq('user_id', owner.user_id)
        .maybeSingle()
    ]);
    memberType = (profile?.member_type ?? null) as MemberType | null;
    ownerName = (mp?.display_name ?? '').trim() || profile?.full_name || null;
  }

  // Average Chain-of-Trust completion across the org's records (0 when none).
  const cotRows = (cot ?? []) as Array<{ completion_percentage: number | null }>;
  const trustPct =
    cotRows.length > 0
      ? Math.round(
          cotRows.reduce((sum, r) => sum + Number(r.completion_percentage ?? 0), 0) / cotRows.length
        )
      : 0;

  return {
    entityName: org?.name ?? 'A FundExecs member',
    ownerName,
    memberType,
    memberLabel: memberType ? MEMBER_TYPE_LABELS[memberType] : 'Member',
    title: (page.title ?? '').trim() || null,
    headline: (page.headline ?? '').trim() || null,
    committedPct: pctOf(committed, target),
    coveragePct: pctOf(committed + softCircled, target),
    showAmounts,
    target: showAmounts ? target : null,
    committed: showAmounts ? committed : null,
    softCircled: showAmounts ? softCircled : null,
    minCheck: page.min_check != null ? Number(page.min_check) : null,
    interestCount: interestCount ?? 0,
    trustPct
  };
}
