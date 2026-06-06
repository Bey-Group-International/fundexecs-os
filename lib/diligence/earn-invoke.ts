import 'server-only';
import { createDiligenceRun, runDiligence, type RunDiligenceResult } from './orchestrator';

/**
 * Earn-facing entrypoint. Lets the Earn chat map an instruction like
 * "review this deck like an institutional LP" to a full diligence run over a
 * deal's already-ingested documents.
 *
 * Membership/authorization is the caller's responsibility — invoke this only
 * after verifying the user is a member of `orgId` (the API route does this).
 * Document ingest (chunking + embeddings into `diligence_chunks`) is Codex's
 * pipeline; this helper assumes chunks already exist for the run's documents.
 */
export interface EarnReviewInput {
  orgId: string;
  createdBy: string;
  dealId?: string | null;
  title?: string | null;
}

export interface EarnReviewResult extends RunDiligenceResult {
  /** The created run id, available even if the run itself errors. */
  runId: string;
}

/**
 * Create a run and execute it inline. Returns once Synthesis completes (or the
 * run errors). For very large document sets a caller may prefer to create the
 * run and trigger `runDiligence` out-of-band, but inline keeps the Earn flow
 * simple and observable.
 */
export async function earnReviewDeal(input: EarnReviewInput): Promise<EarnReviewResult> {
  const run = await createDiligenceRun({
    orgId: input.orgId,
    createdBy: input.createdBy,
    dealId: input.dealId ?? null,
    title: input.title ?? 'Diligence review'
  });
  const result = await runDiligence(run.id);
  return { ...result, runId: run.id };
}
