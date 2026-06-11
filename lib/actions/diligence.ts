'use server';

import { revalidatePath } from 'next/cache';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { recordLoopClose } from '@/lib/actions/loop';
import { createAdminClient } from '@/lib/supabase/admin';
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
