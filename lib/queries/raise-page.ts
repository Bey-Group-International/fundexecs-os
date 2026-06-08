import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getSiteURL } from '@/lib/site-url';

/* ============================================================================
 * lib/queries/raise-page.ts — the org's OWN active raise page (authed read).
 *
 * Runs under the user's session so RLS ("owners manage raise pages") gates the
 * row. Powers the in-app Raise-page manager on the Capital Stack screen. The
 * public read path (/r/<token>) is separate and uses the service-role admin
 * client (lib/queries/public-raise.ts).
 * ========================================================================= */

export interface ActiveRaisePage {
  token: string;
  url: string;
  title: string | null;
  headline: string | null;
  minCheck: number | null;
  showAmounts: boolean;
  /** Inbound "express interest" leads captured so far. */
  interestCount: number;
}

export function raiseShareUrl(token: string): string {
  return `${getSiteURL()}/r/${token}`;
}

/** The org's live (non-revoked, non-expired) raise page, or null. */
export async function getActiveRaisePage(): Promise<ActiveRaisePage | null> {
  const org = await getActiveOrg().catch(() => null);
  if (!org) return null;

  const supabase = await createClient();
  const { data: page } = await supabase
    .from('raise_pages')
    .select('id, token, title, headline, min_check, show_amounts, expires_at')
    .eq('org_id', org.orgId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!page) return null;
  if (page.expires_at && new Date(page.expires_at).getTime() <= Date.now()) return null;

  const { count } = await supabase
    .from('raise_interests')
    .select('id', { count: 'exact', head: true })
    .eq('raise_page_id', page.id);

  return {
    token: page.token,
    url: raiseShareUrl(page.token),
    title: (page.title ?? '').trim() || null,
    headline: (page.headline ?? '').trim() || null,
    minCheck: page.min_check != null ? Number(page.min_check) : null,
    showAmounts: Boolean(page.show_amounts),
    interestCount: count ?? 0
  };
}
