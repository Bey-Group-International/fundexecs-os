import { createClient } from '@/lib/supabase/server';

export type TrustLayerKey = 'truth' | 'concept' | 'execution' | 'work';

const LAYER_ORDER: Record<string, number> = {
  'Proof of Truth': 1,
  'Proof of Concept': 2,
  'Proof of Execution': 3,
  'Proof of Work': 4
};

export function shortLayerKey(label: string): TrustLayerKey {
  switch (label) {
    case 'Proof of Concept':
      return 'concept';
    case 'Proof of Execution':
      return 'execution';
    case 'Proof of Work':
      return 'work';
    default:
      return 'truth';
  }
}

export interface TrustEvidence {
  id: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
  uploader_name: string | null;
  ai_validation_notes: string | null;
  ai_validated_at: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_at: string | null;
  approver_name: string | null;
  rejection_reason: string | null;
  storage_path: string;
}

export interface TrustLayer {
  id: string;
  layerName: string;
  layerKey: TrustLayerKey;
  layerOrder: number;
  status: string;
  completionPct: number;
  evidence: TrustEvidence[];
}

export interface TrustEvent {
  id: string;
  action: string;
  occurredAt: string;
  actorName: string | null;
  metadata: Record<string, unknown>;
}

export interface TrustRecord {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  title: string;
  currentLayer: string;
  currentLayerKey: TrustLayerKey;
  completionPercentage: number;
  status: string;
  layers: TrustLayer[];
  events: TrustEvent[];
  /** Whether the viewer is owner/admin in the record's org. */
  viewerCanApprove: boolean;
  viewerId: string;
}

interface RawLayer {
  id: string;
  layer_name: string;
  layer_order: number;
  human_approval_status: string;
  completion_percentage: number;
}
interface RawEvidence {
  id: string;
  proof_layer_id: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
  ai_validation_notes: string | null;
  ai_validated_at: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  storage_path: string;
}
interface RawEvent {
  id: string;
  action: string;
  created_at: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Load everything the TrustDrawer needs in one go: the record header,
 * its 4 proof layers, every evidence row keyed by layer, the last 20
 * trust_events for the record, and the viewer's approval permission.
 *
 * RLS gates every read, so calling this with a record_id from another
 * org returns null.
 */
export async function getTrustRecord(recordId: string): Promise<TrustRecord | null> {
  if (!recordId) return null;
  const supabase = await createClient();

  const { data: rec } = await supabase
    .from('chain_of_trust_records')
    .select('id, org_id, entity_type, entity_id, current_layer, completion_percentage, status')
    .eq('id', recordId)
    .maybeSingle();
  if (!rec) return null;
  const record = rec as {
    id: string;
    org_id: string;
    entity_type: string;
    entity_id: string;
    current_layer: string;
    completion_percentage: number;
    status: string;
  };

  // Title resolution: try the parent entity (deal/profile/objective).
  let title = `${record.entity_type} · ${record.entity_id.slice(0, 8)}`;
  if (record.entity_type === 'deal') {
    const { data } = await supabase
      .from('deals')
      .select('name')
      .eq('id', record.entity_id)
      .maybeSingle();
    if (data) title = (data as { name: string }).name;
  } else if (record.entity_type === 'member_profile') {
    const { data } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', record.entity_id)
      .maybeSingle();
    if (data) {
      const name = (data as { full_name: string }).full_name;
      title = name ? `${name}'s Proof of Truth` : 'Member Proof of Truth';
    }
  } else if (record.entity_type === 'objective') {
    const { data } = await supabase
      .from('governance_objectives')
      .select('objective')
      .eq('id', record.entity_id)
      .maybeSingle();
    if (data) title = (data as { objective: string }).objective;
  }

  const { data: layersRaw } = await supabase
    .from('proof_layers')
    .select('id, layer_name, layer_order, human_approval_status, completion_percentage')
    .eq('chain_record_id', recordId)
    .order('layer_order', { ascending: true });
  const layers: RawLayer[] = (layersRaw ?? []) as RawLayer[];

  const layerIds = layers.map((l) => l.id);
  let evidence: RawEvidence[] = [];
  if (layerIds.length > 0) {
    const { data: evRaw } = await supabase
      .from('evidence')
      .select(
        'id, proof_layer_id, file_name, mime_type, size_bytes, uploaded_at, uploaded_by, ai_validation_notes, ai_validated_at, approval_status, approved_at, approved_by, rejection_reason, storage_path' as never
      )
      .in('proof_layer_id', layerIds)
      .order('created_at', { ascending: true });
    evidence = (evRaw ?? []) as unknown as RawEvidence[];
  }

  // Resolve uploader + approver names.
  const userIds = new Set<string>();
  for (const e of evidence) {
    if (e.uploaded_by) userIds.add(e.uploaded_by);
    if (e.approved_by) userIds.add(e.approved_by);
  }
  let nameMap = new Map<string, string>();
  if (userIds.size > 0) {
    const { data: ppl } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(userIds));
    if (ppl) {
      nameMap = new Map(
        (ppl as { id: string; full_name: string | null }[]).map((p) => [
          p.id,
          p.full_name ?? 'Member'
        ])
      );
    }
  }

  const evidenceByLayer = new Map<string, TrustEvidence[]>();
  for (const e of evidence) {
    if (!evidenceByLayer.has(e.proof_layer_id)) evidenceByLayer.set(e.proof_layer_id, []);
    evidenceByLayer.get(e.proof_layer_id)!.push({
      id: e.id,
      file_name: e.file_name,
      mime_type: e.mime_type,
      size_bytes: e.size_bytes,
      uploaded_at: e.uploaded_at,
      uploaded_by: e.uploaded_by,
      uploader_name: e.uploaded_by ? (nameMap.get(e.uploaded_by) ?? null) : null,
      ai_validation_notes: e.ai_validation_notes,
      ai_validated_at: e.ai_validated_at,
      approval_status: e.approval_status,
      approved_at: e.approved_at,
      approver_name: e.approved_by ? (nameMap.get(e.approved_by) ?? null) : null,
      rejection_reason: e.rejection_reason,
      storage_path: e.storage_path
    });
  }

  const layerOut: TrustLayer[] = layers.map((l) => ({
    id: l.id,
    layerName: l.layer_name,
    layerKey: shortLayerKey(l.layer_name),
    layerOrder: l.layer_order ?? LAYER_ORDER[l.layer_name] ?? 0,
    status: l.human_approval_status,
    completionPct: Number(l.completion_percentage ?? 0),
    evidence: evidenceByLayer.get(l.id) ?? []
  }));

  // Activity timeline.
  const { data: evtsRaw } = await supabase
    .from('trust_events')
    .select('id, action, created_at, actor_id, metadata')
    .eq('org_id', record.org_id)
    .or(`entity_id.eq.${recordId},metadata->>entity_ref.eq.${recordId}`)
    .order('created_at', { ascending: false })
    .limit(20);
  const evts: RawEvent[] = (evtsRaw ?? []) as RawEvent[];

  const actorIds = new Set<string>();
  for (const e of evts) if (e.actor_id) actorIds.add(e.actor_id);
  const actorIdsToFetch = Array.from(actorIds).filter((id) => !nameMap.has(id));
  if (actorIdsToFetch.length > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIdsToFetch);
    if (data) {
      for (const p of data as { id: string; full_name: string | null }[]) {
        nameMap.set(p.id, p.full_name ?? 'Member');
      }
    }
  }

  const events: TrustEvent[] = evts.map((e) => ({
    id: e.id,
    action: e.action,
    occurredAt: e.created_at,
    actorName: e.actor_id ? (nameMap.get(e.actor_id) ?? null) : null,
    metadata: e.metadata ?? {}
  }));

  // Viewer permission lookup.
  const {
    data: { user }
  } = await supabase.auth.getUser();
  let viewerCanApprove = false;
  if (user) {
    const { data: actor } = await supabase
      .from('org_members')
      .select('role, status')
      .eq('org_id', record.org_id)
      .eq('user_id', user.id)
      .maybeSingle();
    const a = actor as { role: string; status: string } | null;
    viewerCanApprove = !!a && a.status === 'active' && (a.role === 'owner' || a.role === 'admin');
  }

  return {
    id: record.id,
    orgId: record.org_id,
    entityType: record.entity_type,
    entityId: record.entity_id,
    title,
    currentLayer: record.current_layer,
    currentLayerKey: shortLayerKey(record.current_layer),
    completionPercentage: Number(record.completion_percentage ?? 0),
    status: record.status,
    layers: layerOut,
    events,
    viewerCanApprove,
    viewerId: user?.id ?? ''
  };
}
