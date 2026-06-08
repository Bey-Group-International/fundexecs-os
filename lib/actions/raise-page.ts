'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { raiseShareUrl } from '@/lib/queries/raise-page';

/* ============================================================================
 * lib/actions/raise-page.ts — mint / edit / revoke the public raise page.
 *
 * All writes run through the authed server client, so the RLS policy ("owners
 * manage raise pages" → private.is_org_admin) is the gate: only an org
 * owner/admin can publish or change their workspace's raise page. The public
 * read (/r/<token>) is separate and uses the service-role admin client.
 * ========================================================================= */

export type RaiseLinkResult =
  | { ok: true; url: string; token: string }
  | { ok: false; error: string };
export type RaiseMutateResult = { ok: true } | { ok: false; error: string };

const TITLE_MAX = 120;
const HEADLINE_MAX = 280;
const MIN_CHECK_MAX = 1_000_000_000_000; // $1T defensive bound

/** Reg D exemption the raise is run under. null = unset. */
export type RaiseExemption = '506b' | '506c';
const EXEMPTIONS: readonly RaiseExemption[] = ['506b', '506c'];

export interface RaisePageFields {
  title?: string | null;
  headline?: string | null;
  minCheck?: number | null;
  showAmounts?: boolean;
  exemption?: RaiseExemption | null;
  /** When true and exemption === '506c', the public page shows the Reserve CTA. */
  acceptReservations?: boolean;
}

function clean(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Return the workspace's live public raise link, minting one if needed.
 * Reuses an existing non-revoked link so the URL is stable across edits.
 */
export async function createRaiseShareLink(): Promise<RaiseLinkResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from('raise_pages')
    .select('token, expires_at')
    .eq('org_id', org.orgId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    existing?.token &&
    (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now())
  ) {
    return { ok: true, url: raiseShareUrl(existing.token), token: existing.token };
  }

  // An expired-but-unrevoked page still holds the one-active-per-org slot (the
  // unique index can't reference now()), so it would block the insert below.
  // Release it by revoking before minting a fresh token.
  const nowIso = new Date().toISOString();
  await supabase
    .from('raise_pages')
    .update({ revoked_at: nowIso })
    .eq('org_id', org.orgId)
    .is('revoked_at', null)
    .not('expires_at', 'is', null)
    .lte('expires_at', nowIso);

  const token = crypto.randomBytes(32).toString('base64url');
  const user = await getAuthUser();
  const { error } = await supabase
    .from('raise_pages')
    .insert({ org_id: org.orgId, token, created_by: user?.id ?? null });

  if (error) {
    // Only a unique-violation (23505) means a concurrent mint won the
    // one-active-per-org race — recover by returning the live link that now
    // exists. Any other error is a real failure and must surface.
    if (error.code !== '23505') {
      return { ok: false, error: 'Could not publish the raise page.' };
    }
    const { data: raced } = await supabase
      .from('raise_pages')
      .select('token, expires_at')
      .eq('org_id', org.orgId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (raced?.token && (!raced.expires_at || new Date(raced.expires_at).getTime() > Date.now())) {
      return { ok: true, url: raiseShareUrl(raced.token), token: raced.token };
    }
    return { ok: false, error: 'Only a workspace owner or admin can publish a raise page.' };
  }

  revalidatePath('/capital-stack');
  return { ok: true, url: raiseShareUrl(token), token };
}

/** Edit the active raise page's public copy (owner/admin only, RLS-enforced). */
export async function updateRaisePage(fields: RaisePageFields): Promise<RaiseMutateResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  let minCheck: number | null = null;
  if (fields.minCheck != null && fields.minCheck !== 0) {
    const n = Number(fields.minCheck);
    if (!Number.isFinite(n) || n < 0 || n > MIN_CHECK_MAX) {
      return { ok: false, error: 'Please enter a valid minimum check.' };
    }
    minCheck = Math.round(n);
  }

  let exemption: RaiseExemption | null = null;
  if (fields.exemption != null) {
    if (!EXEMPTIONS.includes(fields.exemption)) {
      return { ok: false, error: 'Please choose a valid exemption.' };
    }
    exemption = fields.exemption;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('raise_pages')
    .update({
      title: clean(fields.title, TITLE_MAX),
      headline: clean(fields.headline, HEADLINE_MAX),
      min_check: minCheck,
      show_amounts: Boolean(fields.showAmounts),
      exemption,
      accept_reservations: Boolean(fields.acceptReservations)
    })
    .eq('org_id', org.orgId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not save your raise page.' };
  revalidatePath('/capital-stack');
  return { ok: true };
}

/** Revoke (unpublish) a raise page by token (owner/admin only, RLS-enforced). */
export async function revokeRaiseShareLink(token: string): Promise<RaiseMutateResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('raise_pages')
    .update({ revoked_at: new Date().toISOString() })
    .eq('org_id', org.orgId)
    .eq('token', token)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not unpublish the raise page.' };
  revalidatePath('/capital-stack');
  return { ok: true };
}
