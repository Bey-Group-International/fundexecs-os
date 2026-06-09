'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import type { LpQuestionDraft } from '@/components/lp-room/types';

const SIGNED_URL_TTL_SECONDS = 5 * 60;

export type SubmitLpQuestionResult =
  | { ok: true; questionId: string }
  | { ok: false; error: string };

export type OpenLpDocumentResult = { ok: true; signedUrl: string } | { ok: false; error: string };

function refreshLpRoom() {
  revalidatePath('/lp-room');
  revalidatePath('/', 'layout');
}

async function actorDisplayName(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', userId)
    .maybeSingle();
  return data?.full_name?.trim() || data?.role?.trim() || 'LP on record';
}

export async function submitLpQuestion(draft: LpQuestionDraft): Promise<SubmitLpQuestionResult> {
  const body = draft.body?.trim();
  if (!body) return { ok: false, error: 'Question text is required.' };
  if (body.length > 4000) return { ok: false, error: 'Question must be 4,000 characters or less.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const askerName = draft.askerName?.trim() || (await actorDisplayName(org.userId));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lp_room_questions')
    .insert({
      org_id: org.orgId,
      asked_by: org.userId,
      asker_name: askerName,
      body,
      status: 'open'
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Question could not be saved.' };

  try {
    await supabase.from('trust_events').insert({
      org_id: org.orgId,
      actor_id: org.userId,
      entity_type: 'lp_room_question',
      entity_id: data.id,
      action: 'lp_question_submitted',
      metadata: { asker_name: askerName }
    });
  } catch {
    // Audit logging is best-effort; the question itself is the durable record.
  }

  refreshLpRoom();
  return { ok: true, questionId: data.id };
}

export async function openLpDocument(documentId: string): Promise<OpenLpDocumentResult> {
  if (!documentId) return { ok: false, error: 'Missing document id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data: document, error } = await supabase
    .from('lp_room_documents')
    .select('id, org_id, name, storage_bucket, storage_path, access_level')
    .eq('id', documentId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!document || document.org_id !== org.orgId) {
    return { ok: false, error: 'Document not found.' };
  }

  if (document.access_level === 'admin-only') {
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', org.orgId)
      .eq('user_id', org.userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return { ok: false, error: 'Only owners and admins can open this document.' };
    }
  }

  try {
    const admin = createAdminClient();
    const { data: signed, error: signError } = await admin.storage
      .from(document.storage_bucket)
      .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      return { ok: false, error: signError?.message ?? 'Could not create a signed URL.' };
    }

    try {
      await supabase.from('trust_events').insert({
        org_id: org.orgId,
        actor_id: org.userId,
        entity_type: 'lp_room_document',
        entity_id: document.id,
        action: 'lp_document_opened',
        metadata: {
          name: document.name,
          access_level: document.access_level
        }
      });
    } catch {
      // Best-effort audit trail; never block document access after auth succeeds.
    }

    refreshLpRoom();
    return { ok: true, signedUrl: signed.signedUrl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not open the document.'
    };
  }
}
