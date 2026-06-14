'use server';

import { revalidatePath } from 'next/cache';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { recordLoopClose } from '@/lib/actions/loop';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { embedQuery, toVectorLiteral } from '@/lib/ai/voyage';
import { answerDiligenceQuestion } from '@/lib/ai/diligence-qa';
import { getDiligenceRun } from '@/lib/queries/diligence';
import { RETRIEVAL_MATCH_COUNT } from '@/lib/diligence/config';
import type { DiligenceQaAnswer, QaFinding } from '@/lib/diligence/qa';
import {
  earnReviewDeal,
  createDiligenceDocumentUpload,
  ingestDiligenceDocument,
  type CreateDiligenceDocumentUploadResult,
  type DiligenceDocumentKind
} from '@/lib/diligence';

/**
 * User-facing server actions for the Diligence Intelligence Layer.
 *
 * Auth/membership is enforced here via `getActiveOrg()` + `getAuthUser()` before
 * any trusted (service-role) orchestrator work runs. Errors are returned as a
 * result object — never thrown to the client — so the calling UI can render a
 * calm message instead of a crash.
 */

export type RunDiligenceActionResult =
  | { ok: true; runId: string; status: 'complete' | 'error'; conviction: number | null }
  | { ok: false; error: string };

/**
 * Run a full 7-agent diligence review for a deal. Assumes the deal's documents
 * have already been ingested (chunks exist); document upload is a separate flow.
 */
export async function runDiligenceForDeal(dealId: string): Promise<RunDiligenceActionResult> {
  if (!dealId) return { ok: false, error: 'Missing deal id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const user = await getAuthUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  try {
    const result = await earnReviewDeal({
      orgId: org.orgId,
      createdBy: user.id,
      dealId
    });

    // Close the loop: a completed diligence run is proof of execution — feed it
    // back into the member record so readiness rises. Idempotent + best-effort.
    if (result.status === 'complete') {
      try {
        await recordLoopClose({
          source: 'diligence_completed',
          entityType: 'diligence_run',
          entityId: result.runId,
          metadata: { dealId, conviction: result.conviction }
        });
      } catch {
        // Never block the diligence result on the flywheel write.
      }

      // Chain of Trust: the run itself is evidence. Record one real record per
      // completed run (idempotent — same check-first shape as a resolved
      // finding), distinct from the loop-close credit above. A finished
      // committee review is a Proof of Concept; completion tracks conviction so
      // a hesitant verdict reads as partial proof, not a clean pass.
      try {
        const supabase = await createClient();
        const { data: existing } = await supabase
          .from('chain_of_trust_records')
          .select('id')
          .eq('org_id', org.orgId)
          .eq('entity_type', 'diligence_run')
          .eq('entity_id', result.runId)
          .maybeSingle();
        if (!existing) {
          await supabase.from('chain_of_trust_records').insert({
            org_id: org.orgId,
            entity_type: 'diligence_run',
            entity_id: result.runId,
            current_layer: 'Proof of Concept',
            completion_percentage: result.conviction ?? 0,
            status: 'active'
          });
        }
      } catch {
        // Best-effort — never block the diligence result on the trust write.
      }
    }

    revalidatePath('/run/diligence');
    revalidatePath(`/run/diligence/${result.runId}`);
    revalidatePath('/source/pipeline');

    return {
      ok: true,
      runId: result.runId,
      status: result.status,
      conviction: result.conviction
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Diligence review failed.';
    return { ok: false, error: message };
  }
}

export type RequestUploadActionResult =
  | { ok: true; upload: CreateDiligenceDocumentUploadResult }
  | { ok: false; error: string };

/**
 * Mint a signed upload URL for a diligence document against an existing run.
 * Wraps `createDiligenceDocumentUpload` for a future upload UI; auth is enforced
 * here the same way as the run action.
 */
export async function requestDiligenceUpload(input: {
  runId: string;
  fileName: string;
  mimeType: string;
  kind?: DiligenceDocumentKind;
}): Promise<RequestUploadActionResult> {
  if (!input.runId || !input.fileName?.trim()) {
    return { ok: false, error: 'Missing run id or file name.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const user = await getAuthUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  try {
    const upload = await createDiligenceDocumentUpload({
      orgId: org.orgId,
      runId: input.runId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      kind: input.kind
    });
    return { ok: true, upload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not create upload.';
    return { ok: false, error: message };
  }
}

export type IngestUploadActionResult =
  | { ok: true; chunkCount: number }
  | { ok: false; error: string };

/**
 * Index an uploaded diligence document (extract → chunk → embed → store).
 * Called by the upload UI right after the file lands in storage. The document
 * is re-verified against the caller's active org before the trusted
 * (service-role) ingest runs — possession of a document id is not enough.
 */
export async function ingestDiligenceUpload(documentId: string): Promise<IngestUploadActionResult> {
  if (!documentId) return { ok: false, error: 'Missing document id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const user = await getAuthUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const admin = createAdminClient();
  const { data: document } = await admin
    .from('diligence_documents')
    .select('id, org_id, run_id')
    .eq('id', documentId)
    .maybeSingle();
  if (!document || document.org_id !== org.orgId) {
    return { ok: false, error: 'Document not found.' };
  }

  try {
    const result = await ingestDiligenceDocument(documentId);
    revalidatePath(`/run/diligence/${document.run_id}`);
    return { ok: true, chunkCount: result.chunkCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not index the document.';
    return { ok: false, error: message };
  }
}

export type ResolveFindingActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve an open diligence workstream — the prototype's "Clear with Earn"
 * moment. Marks the finding resolved (member-update RLS applies via the
 * org-scoped client), records the resolution note, and ensures a real Chain
 * of Trust record exists for the finding. Only flagged/cautioned findings
 * need resolving; resolving twice is a no-op.
 */
export async function resolveDiligenceFinding(input: {
  runId: string;
  agent: string;
  note?: string;
}): Promise<ResolveFindingActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();

  const { data: finding, error: findErr } = await supabase
    .from('diligence_findings')
    .select('id, org_id, resolved_at, summary')
    .eq('run_id', input.runId)
    .eq('agent', input.agent)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (findErr || !finding) return { ok: false, error: 'Finding not found.' };
  if (finding.resolved_at) return { ok: true };

  const resolution =
    input.note?.trim() ||
    'Resolved by the operator through the approve loop — evidence reviewed and the workstream cleared.';

  const { error: updErr } = await supabase
    .from('diligence_findings')
    .update({ resolved_at: new Date().toISOString(), resolution })
    .eq('id', finding.id);
  if (updErr) return { ok: false, error: updErr.message };

  // Chain of Trust: one real record per resolved finding (idempotent).
  const { data: existing } = await supabase
    .from('chain_of_trust_records')
    .select('id')
    .eq('org_id', org.orgId)
    .eq('entity_type', 'diligence_finding')
    .eq('entity_id', finding.id)
    .maybeSingle();
  if (!existing) {
    await supabase.from('chain_of_trust_records').insert({
      org_id: org.orgId,
      entity_type: 'diligence_finding',
      entity_id: finding.id,
      current_layer: 'Proof of Truth',
      completion_percentage: 100,
      status: 'active'
    });
  }

  revalidatePath(`/run/diligence/${input.runId}`);
  revalidatePath('/run/diligence');
  return { ok: true };
}

export type AskDiligenceActionResult =
  | { ok: true; answer: DiligenceQaAnswer }
  | { ok: false; error: string };

/**
 * Ask Earn a question about a completed diligence run — the "ask Earn about
 * this review" composer. Grounds the answer in the run's synthesis memo + the
 * six analyst findings + (best-effort) document passages retrieved for the
 * question via the same `match_diligence_chunks` RPC the orchestrator uses.
 * Ephemeral: nothing is persisted. Degrades (never throws) so the composer
 * always renders something.
 */
export async function askDiligenceQuestion(input: {
  runId: string;
  question: string;
}): Promise<AskDiligenceActionResult> {
  const question = input.question?.trim();
  if (!input.runId || !question) return { ok: false, error: 'Ask a question first.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const user = await getAuthUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  // Load the run through the RLS-bound reader — also enforces visibility.
  const run = await getDiligenceRun(input.runId);
  if (!run) return { ok: false, error: 'Review not found.' };
  if (run.status !== 'complete' || !run.synthesis) {
    return { ok: false, error: 'Review is still in progress. Try again when complete.' };
  }

  // Best-effort retrieval of document passages for the question. The RPC is
  // service_role-only; the run was already authorised above. A retrieval miss
  // is non-fatal — Earn can still answer from the findings + memo.
  let context: { fileName: string; content: string }[] = [];
  try {
    const vector = await embedQuery(question);
    const admin = createAdminClient();
    const { data } = await admin.rpc('match_diligence_chunks', {
      run_id: input.runId,
      query_embedding: toVectorLiteral(vector),
      match_count: RETRIEVAL_MATCH_COUNT
    });
    context = (data ?? []).map((d) => ({ fileName: d.file_name, content: d.content }));
  } catch {
    context = [];
  }

  const findings: QaFinding[] = run.analysts.map((a) => ({
    label: a.laneLabel,
    score: a.score,
    summary: a.summary,
    detail: a.detail
  }));

  const answer = await answerDiligenceQuestion({
    question,
    subject: run.dealName ?? run.summary ?? null,
    synthesis: run.synthesis
      ? {
          conviction: run.synthesis.conviction,
          recommendation: run.synthesis.recommendation,
          memo: run.synthesis.memo
        }
      : null,
    findings,
    context
  });

  return { ok: true, answer };
}
