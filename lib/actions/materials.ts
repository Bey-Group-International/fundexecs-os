'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getMaterialSourceSnapshot } from '@/lib/queries/materials';
import { getDiligenceRun } from '@/lib/queries/diligence';
import { composeMemo } from '@/lib/diligence/memo';
import { awardTrustXp } from '@/lib/actions/xp';
import type { Database, Json } from '@/lib/supabase/database.types';
import {
  buildMaterialDraft,
  MATERIAL_AUDIENCES,
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  type MaterialAudience,
  type MaterialKind,
  type MaterialSource,
  type MaterialStatus
} from '@/lib/materials/template';

type MaterialInsert = Database['public']['Tables']['capital_materials']['Insert'];
type MaterialUpdate = Database['public']['Tables']['capital_materials']['Update'];
type MaterialRow = Database['public']['Tables']['capital_materials']['Row'];
type VersionInsert = Database['public']['Tables']['capital_material_versions']['Insert'];

export type MaterialActionResult =
  | {
      ok: true;
      materialId: string;
      versionId?: string;
      xp?: number | null;
    }
  | { ok: false; error: string };

export interface CreateMaterialDraftInput {
  kind: string;
  audience: string;
  title?: string | null;
}

export interface SaveMaterialVersionInput {
  materialId: string;
  title: string;
  body: string;
}

function oneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function cleanText(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanBody(value: string | null | undefined, max: number): string {
  return (value ?? '').trim().slice(0, max);
}

function revalidateMaterials() {
  revalidatePath('/materials');
  revalidatePath('/readiness');
  revalidatePath('/command-center');
  revalidatePath('/', 'layout');
}

async function recordMaterialEvent(input: {
  orgId: string;
  userId: string;
  materialId: string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const supabase = await createClient();
    await supabase.from('trust_events').insert({
      org_id: input.orgId,
      actor_id: input.userId,
      entity_type: 'capital_material',
      entity_id: input.materialId,
      action: input.action,
      metadata: (input.metadata ?? {}) as unknown as Json
    });
  } catch {
    // Audit writes should never block the material action.
  }
}

async function nextVersionNumber(materialId: string, orgId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('capital_material_versions')
    .select('version_number')
    .eq('material_id', materialId)
    .eq('org_id', orgId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  return Number((data as { version_number?: number } | null)?.version_number ?? 0) + 1;
}

async function loadMaterial(materialId: string, orgId: string): Promise<MaterialRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('capital_materials')
    .select('*')
    .eq('id', materialId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) return null;
  return data as MaterialRow | null;
}

async function insertVersion(input: {
  materialId: string;
  orgId: string;
  userId: string;
  title: string;
  body: string;
  source: MaterialSource;
  sourceSnapshot: unknown;
}): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const insert: VersionInsert = {
    org_id: input.orgId,
    material_id: input.materialId,
    version_number: await nextVersionNumber(input.materialId, input.orgId),
    title: input.title,
    body: input.body,
    source: input.source,
    source_snapshot: input.sourceSnapshot as Json,
    created_by: input.userId
  };

  const { data, error } = await supabase
    .from('capital_material_versions')
    .insert(insert)
    .select('id')
    .single();

  if (error || !data) return null;
  return data as { id: string };
}

export async function createMaterialDraft(
  input: CreateMaterialDraftInput
): Promise<MaterialActionResult> {
  if (!oneOf(MATERIAL_KINDS, input.kind)) {
    return { ok: false, error: 'Choose a valid material type.' };
  }
  if (!oneOf(MATERIAL_AUDIENCES, input.audience)) {
    return { ok: false, error: 'Choose a valid audience.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const kind = input.kind as MaterialKind;
  const audience = input.audience as MaterialAudience;
  const snapshot = await getMaterialSourceSnapshot(org.orgId);
  const draft = buildMaterialDraft({
    kind,
    audience,
    snapshot,
    title: cleanText(input.title, 160)
  });

  const supabase = await createClient();
  const now = new Date().toISOString();
  const insert: MaterialInsert = {
    org_id: org.orgId,
    created_by: org.userId,
    kind,
    audience,
    title: draft.title,
    status: 'draft',
    last_generated_at: now
  };

  const { data: material, error } = await supabase
    .from('capital_materials')
    .insert(insert)
    .select('id')
    .single();

  if (error || !material) {
    return { ok: false, error: error?.message ?? 'Material could not be created.' };
  }

  const materialId = (material as { id: string }).id;
  const version = await insertVersion({
    materialId,
    orgId: org.orgId,
    userId: org.userId,
    title: draft.title,
    body: draft.body,
    source: 'deterministic_template',
    sourceSnapshot: snapshot
  });

  if (!version) {
    return { ok: false, error: 'Draft shell was created, but the first version did not save.' };
  }

  await recordMaterialEvent({
    orgId: org.orgId,
    userId: org.userId,
    materialId,
    action: 'capital_material_generated',
    metadata: { kind, audience, version_id: version.id }
  });

  revalidateMaterials();
  return { ok: true, materialId, versionId: version.id };
}

/**
 * Compose an IC memo from a completed diligence run and save it as a versioned
 * `ic_memo` material. Deterministic (no LLM call): the memo is assembled from
 * the run's recorded findings, so every claim cites a real lane. RLS-scoped —
 * `getDiligenceRun` only returns a run the caller's org may see.
 */
export async function generateMemoFromDiligence(runId: string): Promise<MaterialActionResult> {
  if (!runId) return { ok: false, error: 'Missing diligence run.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const run = await getDiligenceRun(runId);
  if (!run) return { ok: false, error: 'Diligence run not found.' };
  if (run.status !== 'complete' || !run.synthesis) {
    return { ok: false, error: 'Run the diligence committee to completion first.' };
  }

  const memo = composeMemo(run);
  const sourceSnapshot = {
    diligence_run_id: run.id,
    deal_id: run.dealId,
    conviction: run.synthesis.conviction ?? run.conviction,
    generated_at: new Date().toISOString()
  };

  const supabase = await createClient();
  const insert: MaterialInsert = {
    org_id: org.orgId,
    created_by: org.userId,
    kind: 'ic_memo',
    audience: 'internal_ic',
    title: memo.title.slice(0, 160),
    status: 'draft',
    last_generated_at: new Date().toISOString()
  };

  const { data: material, error } = await supabase
    .from('capital_materials')
    .insert(insert)
    .select('id')
    .single();

  if (error || !material) {
    return { ok: false, error: error?.message ?? 'Memo could not be created.' };
  }

  const materialId = (material as { id: string }).id;
  const version = await insertVersion({
    materialId,
    orgId: org.orgId,
    userId: org.userId,
    title: memo.title.slice(0, 160),
    body: memo.body,
    source: 'deterministic_template',
    sourceSnapshot
  });

  if (!version) {
    return { ok: false, error: 'Memo shell was created, but the first version did not save.' };
  }

  await recordMaterialEvent({
    orgId: org.orgId,
    userId: org.userId,
    materialId,
    action: 'capital_material_generated',
    metadata: { kind: 'ic_memo', diligence_run_id: run.id, version_id: version.id }
  });

  revalidateMaterials();
  return { ok: true, materialId, versionId: version.id };
}

export async function regenerateMaterial(materialId: string): Promise<MaterialActionResult> {
  if (!materialId) return { ok: false, error: 'Missing material id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const material = await loadMaterial(materialId, org.orgId);
  if (!material) return { ok: false, error: 'Material not found.' };
  if (!oneOf(MATERIAL_KINDS, material.kind) || !oneOf(MATERIAL_AUDIENCES, material.audience)) {
    return { ok: false, error: 'Material has an unsupported type or audience.' };
  }

  const snapshot = await getMaterialSourceSnapshot(org.orgId);
  const draft = buildMaterialDraft({
    kind: material.kind as MaterialKind,
    audience: material.audience as MaterialAudience,
    snapshot,
    title: material.title
  });

  const version = await insertVersion({
    materialId: material.id,
    orgId: org.orgId,
    userId: org.userId,
    title: draft.title,
    body: draft.body,
    source: 'deterministic_template',
    sourceSnapshot: snapshot
  });

  if (!version) return { ok: false, error: 'New version could not be saved.' };

  const supabase = await createClient();
  const update: MaterialUpdate = {
    title: draft.title,
    status: 'draft',
    last_generated_at: new Date().toISOString()
  };
  await supabase
    .from('capital_materials')
    .update(update)
    .eq('id', material.id)
    .eq('org_id', org.orgId);

  await recordMaterialEvent({
    orgId: org.orgId,
    userId: org.userId,
    materialId: material.id,
    action: 'capital_material_regenerated',
    metadata: { version_id: version.id }
  });

  revalidateMaterials();
  return { ok: true, materialId: material.id, versionId: version.id };
}

export async function saveMaterialVersion(
  input: SaveMaterialVersionInput
): Promise<MaterialActionResult> {
  if (!input.materialId) return { ok: false, error: 'Missing material id.' };

  const title = cleanText(input.title, 160);
  const body = cleanBody(input.body, 40000);
  if (!title) return { ok: false, error: 'Title is required.' };
  if (!body) return { ok: false, error: 'Body is required.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const material = await loadMaterial(input.materialId, org.orgId);
  if (!material) return { ok: false, error: 'Material not found.' };

  const version = await insertVersion({
    materialId: material.id,
    orgId: org.orgId,
    userId: org.userId,
    title,
    body,
    source: 'manual_edit',
    sourceSnapshot: { savedAt: new Date().toISOString() }
  });

  if (!version) return { ok: false, error: 'Version could not be saved.' };

  const supabase = await createClient();
  await supabase
    .from('capital_materials')
    .update({ title, status: 'draft' })
    .eq('id', material.id)
    .eq('org_id', org.orgId);

  await recordMaterialEvent({
    orgId: org.orgId,
    userId: org.userId,
    materialId: material.id,
    action: 'capital_material_saved',
    metadata: { version_id: version.id }
  });

  revalidateMaterials();
  return { ok: true, materialId: material.id, versionId: version.id };
}

export async function setMaterialStatus(
  materialId: string,
  status: string
): Promise<MaterialActionResult> {
  if (!materialId) return { ok: false, error: 'Missing material id.' };
  if (!oneOf(MATERIAL_STATUSES, status)) {
    return { ok: false, error: 'Choose a valid status.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const update: MaterialUpdate = { status: status as MaterialStatus };
  const { data, error } = await supabase
    .from('capital_materials')
    .update(update)
    .eq('id', materialId)
    .eq('org_id', org.orgId)
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Status could not be updated.' };
  }

  let xp: number | null = null;
  if (status === 'ready') {
    try {
      xp = await awardTrustXp({
        layer: 'concept',
        entityType: 'capital_material',
        entityId: `${materialId}:ready`
      });
    } catch {
      xp = null;
    }
  }

  await recordMaterialEvent({
    orgId: org.orgId,
    userId: org.userId,
    materialId,
    action: 'capital_material_status_changed',
    metadata: { status }
  });

  revalidateMaterials();
  return { ok: true, materialId, xp };
}
