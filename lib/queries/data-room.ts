import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { MAT_DOCS, MAT_LABEL, type MaterialStage, type MaterialValue } from '@/lib/dataroom/config';
import {
  MATERIAL_DB_KIND,
  materialIdForDbKind,
  sanitizeMaterialSpec,
  splitStoredViewer
} from '@/lib/dataroom/persistence';

/**
 * The org's persisted Materials & Data Room state: per-material stage + the
 * operator's build spec (from `capital_materials`), live links (from
 * `data_room_links` + their logged views), and an activity feed derived from
 * those records. Request-cached; degrades to the fresh zero state on failure.
 */
export interface DataRoomLinkState {
  token: string;
  vetting: string;
  /** Set when the link has an expiry; in the past = revoked/expired. */
  expiresAt: string | null;
  /** True when the link no longer admits anyone. */
  expired: boolean;
  /** Real, logged views from `data_room_views` (the public route writes these). */
  viewers: { name: string; email: string | null; verifiedAt: string | null }[];
}

/** Cap the derived feed — the room shows recency, not the full ledger. */
const ACTIVITY_LIMIT = 30;

export interface DataRoomActivityItem {
  who: string;
  act: string;
  at: string; // ISO
  icon: string;
}

export interface DataRoomState {
  stages: Record<string, MaterialStage>;
  specs: Record<string, Record<string, MaterialValue>>;
  /** flow material id → live link. */
  links: Record<string, DataRoomLinkState>;
  activity: DataRoomActivityItem[];
}

export const getDataRoomState = cache(async (orgId: string): Promise<DataRoomState> => {
  const supabase = await createClient();
  const dbKinds = Object.values(MATERIAL_DB_KIND);
  const [{ data: materials }, { data: links }] = await Promise.all([
    supabase
      .from('capital_materials')
      .select('kind, status, spec, updated_at')
      .eq('org_id', orgId)
      .in('kind', dbKinds)
      .order('updated_at', { ascending: false }),
    supabase
      .from('data_room_links')
      .select(
        'id, label, material_kind, token, vetting, expires_at, created_at, data_room_views ( viewer, viewer_email, verified_at )'
      )
      .eq('org_id', orgId)
      // Newest-first so the reducer can pick the most recent live link per
      // material (the read side must not assume one live row per material).
      .order('created_at', { ascending: false })
  ]);

  const stages: DataRoomState['stages'] = Object.fromEntries(
    MAT_DOCS.map((id) => [id, 'Draft' as MaterialStage])
  );
  const specs: DataRoomState['specs'] = {};
  const activity: DataRoomActivityItem[] = [];

  // Latest row per kind wins (ordered desc above).
  const seen = new Set<string>();
  for (const row of materials ?? []) {
    const id = materialIdForDbKind(row.kind);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    specs[id] = sanitizeMaterialSpec(id, row.spec);
    if (row.status === 'ready') {
      stages[id] = 'Ready';
      activity.push({
        who: 'You',
        act: `added ${MAT_LABEL[id]} to the room`,
        at: row.updated_at,
        icon: 'file-plus'
      });
    }
  }

  const now = Date.now();
  const linkMap: DataRoomState['links'] = {};
  for (const row of links ?? []) {
    // The kind column is the structural join; label matching covers rows
    // from before the column existed.
    const id =
      (row.material_kind ? materialIdForDbKind(row.material_kind) : null) ??
      MAT_DOCS.find((d) => MAT_LABEL[d] === row.label);
    if (!id) continue;
    const expired = !!row.expires_at && Date.parse(row.expires_at) < now;
    // Rows arrive newest-first: the first live row per material wins (the most
    // recent live link); an expired row only fills a gap until a live one is
    // seen — so the operator never surfaces a stale share URL.
    if (!linkMap[id] || (linkMap[id].expired && !expired)) {
      linkMap[id] = {
        token: row.token,
        vetting: row.vetting === 'nda' ? 'Accredited + NDA' : row.vetting,
        expiresAt: row.expires_at,
        expired,
        viewers: (row.data_room_views ?? []).map((v) => {
          const split = splitStoredViewer(v.viewer);
          return {
            name: split.name,
            email: v.viewer_email ?? split.email,
            verifiedAt: v.verified_at
          };
        })
      };
    }
    activity.push({
      who: 'You',
      act: `generated a secure link for ${row.label ?? MAT_LABEL[id]}`,
      at: row.created_at,
      icon: 'link'
    });
    for (const v of row.data_room_views ?? []) {
      if (!v.verified_at) continue;
      activity.push({
        who: splitStoredViewer(v.viewer).name,
        act: `verified and opened ${row.label ?? MAT_LABEL[id]}`,
        at: v.verified_at,
        icon: 'eye'
      });
    }
  }

  activity.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { stages, specs, links: linkMap, activity: activity.slice(0, ACTIVITY_LIMIT) };
});
