'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { awardTrustXp } from '@/lib/actions/xp';
import { getTrustRecord, type TrustRecord } from '@/lib/queries/trust';
import { aiValidateEvidence as runAiValidation } from '@/lib/ai/trust-validate';

const TRUST_BUCKET = 'trust-evidence';

const LAYER_LABELS = {
  truth: 'Proof of Truth',
  concept: 'Proof of Concept',
  execution: 'Proof of Execution',
  work: 'Proof of Work'
} as const;
const LAYER_ORDER = {
  'Proof of Truth': 1,
  'Proof of Concept': 2,
  'Proof of Execution': 3,
  'Proof of Work': 4
} as const;
type LayerKey = keyof typeof LAYER_LABELS;
type LayerLabel = (typeof LAYER_LABELS)[LayerKey];
const ALL_LAYERS: LayerKey[] = ['truth', 'concept', 'execution', 'work'];

const MIME_ALLOWLIST = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/json',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);
const MAX_BYTES = 25 * 1024 * 1024;

function shortLayer(label: string): LayerKey {
  switch (label) {
    case 'Proof of Truth':
      return 'truth';
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

function refresh() {
  revalidatePath('/', 'layout');
}

// ====================================================================
// 0. loadTrustRecord — server-action wrapper around the read query so
//    the (client) TrustDrawer can fetch + refresh without leaving the
//    component. Bound by RLS at every step.
// ====================================================================

export type LoadTrustResult = { ok: true; record: TrustRecord } | { ok: false; error: string };

export async function loadTrustRecord(recordId: string): Promise<LoadTrustResult> {
  if (!recordId) return { ok: false, error: 'Missing record id.' };
  const record = await getTrustRecord(recordId);
  if (!record) return { ok: false, error: 'Trust record not found.' };
  return { ok: true, record };
}

// ====================================================================
// 1. startChainOfTrust
// ====================================================================

export interface StartChainInput {
  subjectEntityType: 'deal' | 'member_profile' | 'objective' | 'org';
  subjectEntityId: string;
  title: string;
}
export type StartChainResult = { ok: true; recordId: string } | { ok: false; error: string };

export async function startChainOfTrust(input: StartChainInput): Promise<StartChainResult> {
  if (!input.subjectEntityId) return { ok: false, error: 'Missing subject id.' };
  if (!input.title?.trim()) return { ok: false, error: 'Missing title.' };
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();

  // Idempotency: if a record already exists for this entity, return it.
  const { data: existing } = await supabase
    .from('chain_of_trust_records')
    .select('id')
    .eq('org_id', org.orgId)
    .eq('entity_type', input.subjectEntityType)
    .eq('entity_id', input.subjectEntityId)
    .maybeSingle();
  if (existing && (existing as { id: string }).id) {
    return { ok: true, recordId: (existing as { id: string }).id };
  }

  const { data: record, error: recordErr } = await supabase
    .from('chain_of_trust_records')
    .insert({
      org_id: org.orgId,
      entity_type: input.subjectEntityType,
      entity_id: input.subjectEntityId,
      current_layer: 'Proof of Truth',
      completion_percentage: 0,
      status: 'active'
    })
    .select('id')
    .single();
  if (recordErr || !record) {
    return { ok: false, error: recordErr?.message ?? 'Insert failed.' };
  }
  const recordId = (record as { id: string }).id;

  const layerRows = ALL_LAYERS.map((short, i) => ({
    org_id: org.orgId,
    chain_record_id: recordId,
    layer_name: LAYER_LABELS[short],
    layer_order: i + 1,
    required_documents: [],
    required_tasks: [],
    human_approval_status: 'pending',
    completion_percentage: 0
  }));
  const { error: layersErr } = await supabase.from('proof_layers').insert(layerRows);
  if (layersErr) {
    return { ok: false, error: layersErr.message };
  }

  refresh();
  return { ok: true, recordId };
}

// ====================================================================
// 2. advanceProofLayer (manually flag a layer as in_progress)
// ====================================================================

export type AdvanceResult = { ok: true } | { ok: false; error: string };

export async function advanceProofLayer(
  recordId: string,
  targetLayer: LayerKey
): Promise<AdvanceResult> {
  if (!recordId) return { ok: false, error: 'Missing record id.' };
  const targetLabel = LAYER_LABELS[targetLayer];

  const supabase = await createClient();
  const { data: layers } = await supabase
    .from('proof_layers')
    .select('layer_name, human_approval_status, layer_order')
    .eq('chain_record_id', recordId)
    .order('layer_order', { ascending: true });
  if (!layers) return { ok: false, error: 'No layers found.' };

  const target = layers.find((l) => (l as { layer_name: string }).layer_name === targetLabel) as
    | { layer_name: string; human_approval_status: string; layer_order: number }
    | undefined;
  if (!target) return { ok: false, error: 'Target layer not found.' };

  const priors = (
    layers as { layer_name: string; human_approval_status: string; layer_order: number }[]
  ).filter((l) => l.layer_order < target.layer_order);
  if (priors.some((p) => p.human_approval_status !== 'approved')) {
    return { ok: false, error: 'All prior layers must be approved before advancing.' };
  }

  const { error } = await supabase
    .from('proof_layers')
    .update({ human_approval_status: 'in_progress' })
    .eq('chain_record_id', recordId)
    .eq('layer_name', targetLabel);
  if (error) return { ok: false, error: error.message };

  refresh();
  return { ok: true };
}

// ====================================================================
// 3. uploadEvidence — server step 1 (insert row + signed upload url)
// ====================================================================

export interface UploadEvidenceInput {
  recordId: string;
  layer: LayerKey;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  notes?: string;
}
export type UploadEvidenceResult =
  | {
      ok: true;
      evidenceId: string;
      signedUrl: string;
      token: string;
      storagePath: string;
    }
  | { ok: false; error: string };

export async function uploadEvidence(input: UploadEvidenceInput): Promise<UploadEvidenceResult> {
  if (!input.recordId || !input.fileName?.trim()) {
    return { ok: false, error: 'Missing record id or file name.' };
  }
  if (!MIME_ALLOWLIST.has(input.mimeType)) {
    return { ok: false, error: `File type ${input.mimeType} is not supported.` };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: 'Invalid file size.' };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: 'File exceeds 25 MB limit.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const layerLabel = LAYER_LABELS[input.layer];
  const { data: layer } = await supabase
    .from('proof_layers')
    .select('id, org_id')
    .eq('chain_record_id', input.recordId)
    .eq('layer_name', layerLabel)
    .maybeSingle();
  if (!layer) return { ok: false, error: 'Proof layer not found.' };
  const layerRow = layer as { id: string; org_id: string };

  // Sanitise filename — strip path traversal & whitespace.
  const safeName = input.fileName.replace(/[\\/]/g, '_').replace(/\s+/g, '_').slice(0, 200);

  const { data: ev, error: evErr } = await supabase
    .from('evidence')
    .insert({
      org_id: layerRow.org_id,
      proof_layer_id: layerRow.id,
      uploaded_by: org.userId,
      storage_path: 'pending',
      file_name: safeName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      notes: input.notes ?? null,
      approval_status: 'pending'
    })
    .select('id')
    .single();
  if (evErr || !ev) {
    return { ok: false, error: evErr?.message ?? 'Insert failed.' };
  }
  const evidenceId = (ev as { id: string }).id;
  const storagePath = `${layerRow.org_id}/${input.recordId}/${evidenceId}/${safeName}`;

  // Update the row with the canonical storage_path now that we have the id.
  await supabase.from('evidence').update({ storage_path: storagePath }).eq('id', evidenceId);

  // Signed upload URL — expires in 60s. Service-role used here purely
  // to mint the upload token; the actual upload is bound to that token
  // and gated by storage RLS at the object level.
  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from(TRUST_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    // Roll back the evidence row so we don't leave an orphan.
    await supabase.from('evidence').delete().eq('id', evidenceId);
    return { ok: false, error: signErr?.message ?? 'Could not create signed URL.' };
  }

  refresh();
  return {
    ok: true,
    evidenceId,
    signedUrl: signed.signedUrl,
    token: signed.token,
    storagePath
  };
}

// ====================================================================
// 4. finalizeEvidenceUpload — confirm + kick off AI validation
// ====================================================================

export type FinalizeResult = { ok: true } | { ok: false; error: string };

export async function finalizeEvidenceUpload(evidenceId: string): Promise<FinalizeResult> {
  if (!evidenceId) return { ok: false, error: 'Missing evidence id.' };
  const supabase = await createClient();

  const { data: ev, error: evErr } = await supabase
    .from('evidence')
    .select('id, storage_path, mime_type, size_bytes, file_name, org_id')
    .eq('id', evidenceId)
    .maybeSingle();
  if (evErr || !ev) return { ok: false, error: 'Evidence not found.' };

  // Confirm the object actually exists in storage (defends against
  // clients calling finalize without uploading).
  const admin = createAdminClient();
  const evRow = ev as {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    file_name: string;
    org_id: string;
  };
  const { data: head } = await admin.storage
    .from(TRUST_BUCKET)
    .list(evRow.storage_path.split('/').slice(0, -1).join('/'), {
      search: evRow.file_name
    });
  const found = head && head.some((o) => evRow.storage_path.endsWith(`/${o.name}`));
  if (!found) {
    return { ok: false, error: 'Upload did not complete.' };
  }

  await supabase
    .from('evidence')
    .update({ uploaded_at: new Date().toISOString() })
    .eq('id', evidenceId);

  // Fire-and-forget AI validation. Never block the parent action.
  void runAiValidation(evidenceId).catch(() => undefined);

  refresh();
  return { ok: true };
}

// ====================================================================
// 6. approveEvidence (decision='approved'|'rejected')
// ====================================================================

export interface ApproveInput {
  evidenceId: string;
  decision: 'approved' | 'rejected';
  rejectionReason?: string;
}
export type ApproveResult = { ok: true } | { ok: false; error: string };

export async function approveEvidence(input: ApproveInput): Promise<ApproveResult> {
  if (!input.evidenceId) return { ok: false, error: 'Missing evidence id.' };
  if (!['approved', 'rejected'].includes(input.decision)) {
    return { ok: false, error: 'Invalid decision.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  // Authorise: actor must be owner/admin OR the evidence's uploader.
  const { data: ev } = await supabase
    .from('evidence')
    .select('id, org_id, proof_layer_id, uploaded_by, approval_status')
    .eq('id', input.evidenceId)
    .maybeSingle();
  if (!ev) return { ok: false, error: 'Evidence not found.' };
  const evRow = ev as {
    id: string;
    org_id: string;
    proof_layer_id: string;
    uploaded_by: string | null;
    approval_status: string;
  };
  if (evRow.approval_status === 'approved') {
    return { ok: false, error: 'Evidence is already approved.' };
  }

  const { data: actor } = await supabase
    .from('org_members')
    .select('role, status')
    .eq('org_id', evRow.org_id)
    .eq('user_id', org.userId)
    .maybeSingle();
  const actorRow = actor as { role: string; status: string } | null;
  const isAdmin =
    !!actorRow &&
    actorRow.status === 'active' &&
    (actorRow.role === 'owner' || actorRow.role === 'admin');
  const isUploader = evRow.uploaded_by === org.userId;
  if (!isAdmin && !isUploader) {
    return {
      ok: false,
      error: 'Only owners, admins, or the uploader can decide on this evidence.'
    };
  }

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from('evidence')
    .update({
      approval_status: input.decision,
      approved_by: org.userId,
      approved_at: now,
      rejection_reason: input.decision === 'rejected' ? (input.rejectionReason ?? null) : null
    })
    .eq('id', input.evidenceId);
  if (upErr) return { ok: false, error: upErr.message };

  // If approved, check if this push the proof_layer to "approved" status.
  let layerAdvanced = false;
  if (input.decision === 'approved') {
    const { data: layer } = await supabase
      .from('proof_layers')
      .select('id, layer_name, layer_order, chain_record_id, human_approval_status')
      .eq('id', evRow.proof_layer_id)
      .maybeSingle();
    const layerRow = layer as {
      id: string;
      layer_name: LayerLabel;
      layer_order: number;
      chain_record_id: string;
      human_approval_status: string;
    } | null;

    if (layerRow && layerRow.human_approval_status !== 'approved') {
      const { count: approvedCount } = await supabase
        .from('evidence')
        .select('id', { count: 'exact', head: true })
        .eq('proof_layer_id', layerRow.id)
        .eq('approval_status', 'approved');
      if ((approvedCount ?? 0) >= 1) {
        await supabase
          .from('proof_layers')
          .update({ human_approval_status: 'approved', completion_percentage: 100 })
          .eq('id', layerRow.id);
        layerAdvanced = true;

        // Advance chain record's current_layer to next sequential.
        const nextOrder = layerRow.layer_order + 1;
        const nextLabel = (Object.keys(LAYER_ORDER) as LayerLabel[]).find(
          (l) => LAYER_ORDER[l] === nextOrder
        );
        const isWork = layerRow.layer_name === 'Proof of Work';
        await supabase
          .from('chain_of_trust_records')
          .update({
            current_layer: isWork ? 'Proof of Work' : (nextLabel ?? layerRow.layer_name),
            completion_percentage: isWork ? 100 : 25 * layerRow.layer_order
          })
          .eq('id', layerRow.chain_record_id);

        // XP for the layer that was just approved.
        try {
          await awardTrustXp({
            layer: shortLayer(layerRow.layer_name),
            entityType: 'chain_of_trust',
            entityId: layerRow.chain_record_id
          });
        } catch {
          // best-effort
        }
      }
    }
  }

  // Audit row.
  try {
    await supabase.from('trust_events').insert({
      org_id: evRow.org_id,
      actor_id: org.userId,
      entity_type: 'evidence',
      entity_id: input.evidenceId,
      action: input.decision === 'approved' ? 'evidence_approved' : 'evidence_rejected',
      metadata: {
        layer_advanced: layerAdvanced,
        rejection_reason: input.rejectionReason ?? null
      }
    });
  } catch {
    // best-effort
  }

  refresh();
  return { ok: true };
}

// ====================================================================
// 7. revokeEvidence (uploader-only, pending evidence)
// ====================================================================

export type RevokeResult = { ok: true } | { ok: false; error: string };

export async function revokeEvidence(evidenceId: string): Promise<RevokeResult> {
  if (!evidenceId) return { ok: false, error: 'Missing evidence id.' };
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data: ev } = await supabase
    .from('evidence')
    .select('id, storage_path, uploaded_by, approval_status')
    .eq('id', evidenceId)
    .maybeSingle();
  if (!ev) return { ok: false, error: 'Evidence not found.' };
  const evRow = ev as {
    id: string;
    storage_path: string;
    uploaded_by: string | null;
    approval_status: string;
  };
  if (evRow.uploaded_by !== org.userId) {
    return { ok: false, error: 'Only the uploader can revoke.' };
  }
  if (evRow.approval_status === 'approved') {
    return { ok: false, error: 'Approved evidence cannot be revoked.' };
  }

  const admin = createAdminClient();
  await admin.storage.from(TRUST_BUCKET).remove([evRow.storage_path]);
  await supabase.from('evidence').delete().eq('id', evidenceId);

  refresh();
  return { ok: true };
}
