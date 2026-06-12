import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAT_DOCS, MAT_LABEL, type MaterialValue } from './config';
import { MATERIAL_DB_KIND, materialIdForDbKind, sanitizeMaterialSpec } from './persistence';

/**
 * lib/dataroom/public.ts — the read side of the public `/dr/[token]` route.
 *
 * Viewers are anonymous, so RLS (org-member scoped) can't serve them; reads
 * run through the service-role client, keyed strictly by the unguessable
 * link token. Only what the share page needs ever leaves this module —
 * label, vetting, firm name, and the built material's outline.
 */

export interface PublicDataRoom {
  linkId: string;
  orgId: string;
  label: string;
  vetting: string;
  expired: boolean;
  firm: string;
  material: {
    materialId: string;
    title: string;
    spec: Record<string, MaterialValue>;
    preparedAt: string | null;
  } | null;
}

/** Resolve a share token to its room. Null when the token doesn't exist. */
export async function getPublicDataRoom(token: string): Promise<PublicDataRoom | null> {
  const clean = (token ?? '').trim();
  if (!clean || clean.length > 64) return null;

  // Degrade to "no room" on any infra failure (e.g. service-role env missing
  // on a preview deployment) — a public link must never 500.
  try {
    const admin = createAdminClient();
    const { data: link } = await admin
      .from('data_room_links')
      .select('id, org_id, label, material_kind, vetting, expires_at')
      .eq('token', clean)
      .maybeSingle();
    if (!link || !link.label) return null;

    const expired = !!link.expires_at && Date.parse(link.expires_at) < Date.now();

    const { data: org } = await admin
      .from('organizations')
      .select('name')
      .eq('id', link.org_id)
      .maybeSingle();

    // The kind column is the structural join; label matching covers rows
    // from before the column existed.
    const materialId =
      (link.material_kind ? materialIdForDbKind(link.material_kind) : null) ??
      MAT_DOCS.find((d) => MAT_LABEL[d] === link.label) ??
      null;
    let material: PublicDataRoom['material'] = null;
    if (materialId && !expired) {
      const { data: row } = await admin
        .from('capital_materials')
        .select('title, status, spec, last_generated_at')
        .eq('org_id', link.org_id)
        .eq('kind', MATERIAL_DB_KIND[materialId])
        .eq('status', 'ready')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (row) {
        material = {
          materialId,
          title: row.title || link.label,
          spec: sanitizeMaterialSpec(materialId, row.spec),
          preparedAt: row.last_generated_at
        };
      }
    }

    return {
      linkId: link.id,
      orgId: link.org_id,
      label: link.label,
      vetting: link.vetting,
      expired,
      firm: org?.name ?? 'The manager',
      material
    };
  } catch {
    return null;
  }
}
