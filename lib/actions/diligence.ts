'use server';

import { revalidatePath } from 'next/cache';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import {
  earnReviewDeal,
  createDiligenceDocumentUpload,
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

    revalidatePath('/diligence');
    revalidatePath(`/diligence/${result.runId}`);
    revalidatePath('/pipeline');

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
