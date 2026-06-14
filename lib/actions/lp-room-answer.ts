'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import { requireOrgManager } from '@/lib/access.server';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { draftLpAnswerWithEarn } from '@/lib/ai/lp-answer';
import type { LpAnswerDraft } from '@/lib/lp-room/answer';

/* ============================================================================
 * lib/actions/lp-room-answer.ts — Earn answers an LP question from approved
 * materials and posts it to the room thread.
 *
 * GP-only (owner/admin): an answer is the fund's official response. Eleanor
 * drafts it grounded ONLY in the room's approved documents + the Source of
 * Truth, then we persist the answer + citations via the service role (the
 * `lp_room_answers` table is service-role write by design) and mark the
 * question answered. Returns the draft so the UI can render it immediately.
 * ========================================================================= */

export type AnswerLpQuestionResult =
  | { ok: true; answer: LpAnswerDraft }
  | { ok: false; error: string };

export async function answerLpQuestionWithEarn(
  questionId: string
): Promise<AnswerLpQuestionResult> {
  if (!questionId?.trim()) return { ok: false, error: 'Missing question.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const isManager = await requireOrgManager(org.orgId);
  if (!isManager) {
    return { ok: false, error: 'Only the GP (owner or admin) can post an answer.' };
  }

  const supabase = await createClient();
  const { data: question, error } = await supabase
    .from('lp_room_questions')
    .select('id, org_id, asker_name, body, status')
    .eq('id', questionId)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!question) return { ok: false, error: 'Question not found.' };
  if (question.status === 'answered') {
    return { ok: false, error: 'This question has already been answered.' };
  }

  // Approved materials: room documents the LP is entitled to (not admin-only).
  // Fail closed if the materials can't be loaded — we don't answer "as if there
  // are none" when the read errored.
  const [{ data: docs, error: docsError }, profile] = await Promise.all([
    supabase
      .from('lp_room_documents')
      .select('id, name, access_level')
      .eq('org_id', org.orgId)
      .neq('access_level', 'admin-only'),
    getFundProfile(org.orgId).catch(() => null)
  ]);

  if (docsError) return { ok: false, error: 'Could not load the approved materials.' };

  const docList = (docs ?? []) as Array<{ id: string; name: string }>;

  const draft = await draftLpAnswerWithEarn({
    question: question.body,
    askerName: question.asker_name,
    fund: {
      name: profile?.fundName ?? 'the fund',
      thesis: profile?.thesis ?? null,
      strategy: profile?.strategy ?? null,
      targetRaise: profile?.targetRaise ?? null
    },
    approvedDocs: docList.map((d) => d.name)
  });

  // Persist via the service role (lp_room_answers is service-role write).
  const admin = createAdminClient();
  const { data: answerRow, error: answerError } = await admin
    .from('lp_room_answers')
    .insert({
      org_id: org.orgId,
      question_id: question.id,
      author_id: org.userId,
      author_name: 'Eleanor',
      author_role: 'Head of Investor Relations',
      body: draft.answer
    })
    .select('id')
    .single();

  if (answerError || !answerRow) {
    return { ok: false, error: answerError?.message ?? 'Could not post the answer.' };
  }

  // Map cited labels back to room documents where the name matches. Fail closed
  // so a citation-tracking failure surfaces rather than silently shipping an
  // uncited official answer.
  if (draft.citations.length > 0) {
    const docByName = new Map(docList.map((d) => [d.name.toLowerCase(), d.id]));
    const rows = draft.citations.map((label) => ({
      org_id: org.orgId,
      answer_id: answerRow.id,
      document_id: docByName.get(label.toLowerCase()) ?? null,
      label
    }));
    const { error: citationError } = await admin.from('lp_room_answer_citations').insert(rows);
    if (citationError) return { ok: false, error: 'Could not record the answer citations.' };
  }

  // Mark the question answered — fail closed so the thread state stays accurate.
  const { error: statusError } = await admin
    .from('lp_room_questions')
    .update({ status: 'answered' })
    .eq('id', question.id)
    .eq('org_id', org.orgId);
  if (statusError) return { ok: false, error: 'Posted the answer but could not update status.' };

  revalidatePath('/lp-room');
  return { ok: true, answer: draft };
}
