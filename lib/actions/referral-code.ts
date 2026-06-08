'use server';

import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { getSiteURL } from '@/lib/site-url';
import type { Database } from '@/lib/supabase/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReferralLinkResult =
  | { ok: true; url: string; code: string }
  | { ok: false; error: string };

/** Build the public capture URL for a code. */
function referralUrl(code: string): string {
  return `${getSiteURL()}/r/${code}`;
}

/** A short, url-safe code (~8 chars). Enough entropy to be unguessable in a share link. */
function newCode(): string {
  return crypto.randomBytes(6).toString('base64url');
}

/**
 * Resolve the stable referral code for `(userId, orgId)`, minting one on first
 * use. The row is keyed by `user_id` (one code per user), so a user always sees
 * the same link. Service-role: the get-or-create touches another user's row only
 * via the unique `code` collision path, never reads cross-user data.
 *
 * Returns the code, or `null` if it could not be created (e.g. transient DB
 * error after exhausting unique-collision retries).
 */
export async function getOrCreateReferralCode(
  admin: SupabaseClient<Database>,
  userId: string,
  orgId: string
): Promise<string | null> {
  // Fast path — already have one.
  const { data: existing } = await admin
    .from('user_referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle();
  if (existing?.code) return existing.code;

  // Mint, retrying only on a code collision (the unique index). A user_id
  // collision means a concurrent insert already created the row — re-read it.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const { data, error } = await admin
      .from('user_referral_codes')
      .insert({ user_id: userId, org_id: orgId, code })
      .select('code')
      .maybeSingle();

    if (data?.code) return data.code;
    if (!error) continue;

    // 23505 = unique_violation. If it's the primary key (user_id) that lost a
    // race, the row now exists — read it back. Otherwise the code collided; retry.
    if (error.code === '23505') {
      const { data: raced } = await admin
        .from('user_referral_codes')
        .select('code')
        .eq('user_id', userId)
        .maybeSingle();
      if (raced?.code) return raced.code;
      continue;
    }
    // Non-collision error — give up.
    break;
  }
  return null;
}

/**
 * Server action — resolve the signed-in user's personal referral link, minting
 * the code on first call. Used by the Copy button on the /referrals page (the
 * page itself fetches the link server-side via `getOrCreateReferralCode`).
 */
export async function getMyReferralLink(): Promise<ReferralLinkResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const admin = createAdminClient();
  const code = await getOrCreateReferralCode(admin, org.userId, org.orgId);
  if (!code) return { ok: false, error: 'Could not create your referral link. Please try again.' };

  return { ok: true, url: referralUrl(code), code };
}
