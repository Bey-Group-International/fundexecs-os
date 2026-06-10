'use server';

import { getActiveOrg } from '@/lib/queries/org';
import { requireOrgManager } from '@/lib/access.server';
import {
  getAdminActivity,
  type ActivityCursor,
  type ActivityPage,
  type ActivityTargetType
} from '@/lib/queries/admin-activity';

export type LoadActivityResult = { ok: true; page: ActivityPage } | { ok: false; error: string };

/**
 * Load one page of the caller's org audit log for the Admin portal's Activity
 * tab — the "load more / filter" companion to the 10 rows the page ships with.
 * Admin-gated on top of RLS (which already scopes `admin_actions` reads to org
 * admins), and bounded to the caller's active org.
 */
export async function loadAdminActivity(
  opts: {
    cursor?: ActivityCursor | null;
    targetType?: ActivityTargetType | null;
  } = {}
): Promise<LoadActivityResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };
  if (!(await requireOrgManager(org.orgId))) {
    return { ok: false, error: 'Only org owners and admins can read the audit log.' };
  }

  const page = await getAdminActivity(org.orgId, {
    cursor: opts.cursor ?? undefined,
    targetType: opts.targetType ?? undefined
  });
  return { ok: true, page };
}
