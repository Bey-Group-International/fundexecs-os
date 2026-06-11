import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { MAT_DOCS, MAT_LABEL, type MaterialStage, type MaterialValue } from '@/lib/dataroom/config';
import {
  MATERIAL_DB_KIND,
  materialIdForDbKind,
  sanitizeMaterialSpec
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
  /** Real, logged views from `data_room_views` (the public route writes these). */
  viewers: { name: string; verifiedAt: string | null }[];
}

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
      .select('id, label, token, vetting, created_at, data_room_views ( viewer, verified_at )')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
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

  const linkMap: DataRoomState['links'] = {};
  for (const row of links ?? []) {
    const id = MAT_DOCS.find((d) => MAT_LABEL[d] === row.label);
    if (!id) continue;
    linkMap[id] = {
      token: row.token,
      vetting: row.vetting === 'nda' ? 'Accredited + NDA' : row.vetting,
      viewers: (row.data_room_views ?? []).map((v) => ({
        name: v.viewer,
        verifiedAt: v.verified_at
      }))
    };
    activity.push({
      who: 'You',
      act: `generated a secure link for ${row.label}`,
      at: row.created_at,
      icon: 'link'
    });
  }

  activity.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { stages, specs, links: linkMap, activity };
});
