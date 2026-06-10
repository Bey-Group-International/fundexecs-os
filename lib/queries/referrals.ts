import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/** One referred org and how much its referrer has earned from it so far. */
export interface ReferralRow {
  referredOrgId: string;
  referredUserId: string;
  referredName: string | null;
  source: 'beta_link' | 'beta_invite' | 'peer';
  sourceId: string | null;
  joinedAt: string;
  creditsEarned: number;
  /** Most recent commission timestamp, if any. */
  lastRewardAt: string | null;
}

export interface ReferralOverview {
  /** Total commission credits this org has earned across all its referrals. */
  totalEarned: number;
  referredCount: number;
  rows: ReferralRow[];
  /**
   * source_id → credits earned, so the invite / link panels can badge each row
   * with what it has paid out. Keyed by `beta_invites.id` / `beta_links.id`.
   */
  earningsBySource: Record<string, number>;
}

const EMPTY: ReferralOverview = {
  totalEarned: 0,
  referredCount: 0,
  rows: [],
  earningsBySource: {}
};

/** One configured commission level: tier 1 = the direct referrer, tier 2 = the
 *  referrer's referrer, … Rates are basis points (1000 = 10%). */
export interface ReferralTier {
  tier: number;
  rateBps: number;
}

/** What the payout engine grants when no tiers can be read — the documented
 *  direct rate, so the UI copy never claims a rate the DB doesn't back. */
const FALLBACK_TIERS: ReferralTier[] = [{ tier: 1, rateBps: 1000 }];

/**
 * Read the configured commission ladder from `referral_tiers` (the same table
 * `grant_referral_commission` pays from), so the Referrals panel shows the
 * rates that are actually granted instead of hardcoded copy. RLS: readable by
 * any authenticated user (rates aren't secret). Falls back to the documented
 * direct 10% on any failure.
 */
export async function getReferralTiers(): Promise<ReferralTier[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('referral_tiers')
      .select('tier, rate_bps')
      .order('tier', { ascending: true });
    if (error || !data || data.length === 0) return FALLBACK_TIERS;
    return data.map((t) => ({ tier: t.tier, rateBps: t.rate_bps }));
  } catch {
    return FALLBACK_TIERS;
  }
}

/**
 * Resolve the referral + commission picture for `orgId` acting as the referrer.
 * Service-role (a referrer can't read referred orgs/profiles under RLS); the
 * admin section that calls this is already platform-admin gated. Best-effort —
 * any failure returns an empty overview so the admin page still renders.
 */
export async function getReferralOverview(orgId: string): Promise<ReferralOverview> {
  try {
    const admin = createAdminClient();
    const { data: refs } = await admin
      .from('referrals')
      .select('id, referred_org_id, referred_user_id, source, source_id, created_at')
      .eq('referrer_org_id', orgId)
      .order('created_at', { ascending: false });

    if (!refs || refs.length === 0) return EMPTY;

    const refIds = refs.map((r) => r.id);
    const { data: rewards } = await admin
      .from('referral_rewards')
      .select('referral_id, commission_credits, created_at')
      .in('referral_id', refIds);

    const earnedByRef = new Map<string, number>();
    const lastRewardByRef = new Map<string, string>();
    for (const rw of rewards ?? []) {
      earnedByRef.set(
        rw.referral_id,
        (earnedByRef.get(rw.referral_id) ?? 0) + rw.commission_credits
      );
      const prev = lastRewardByRef.get(rw.referral_id);
      if (!prev || rw.created_at > prev) lastRewardByRef.set(rw.referral_id, rw.created_at);
    }

    const userIds = [...new Set(refs.map((r) => r.referred_user_id))];
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);
    const nameById = new Map<string, string | null>();
    for (const p of profiles ?? []) nameById.set(p.id, p.full_name?.trim() || null);

    const rows: ReferralRow[] = refs.map((r) => ({
      referredOrgId: r.referred_org_id,
      referredUserId: r.referred_user_id,
      referredName: nameById.get(r.referred_user_id) ?? null,
      source: r.source === 'beta_link' || r.source === 'peer' ? r.source : 'beta_invite',
      sourceId: r.source_id,
      joinedAt: r.created_at,
      creditsEarned: earnedByRef.get(r.id) ?? 0,
      lastRewardAt: lastRewardByRef.get(r.id) ?? null
    }));

    const earningsBySource: Record<string, number> = {};
    for (const r of rows) {
      if (r.sourceId) {
        earningsBySource[r.sourceId] = (earningsBySource[r.sourceId] ?? 0) + r.creditsEarned;
      }
    }

    return {
      totalEarned: rows.reduce((s, r) => s + r.creditsEarned, 0),
      referredCount: rows.length,
      rows,
      earningsBySource
    };
  } catch (error) {
    console.error('[referrals] overview failed', error);
    return EMPTY;
  }
}
