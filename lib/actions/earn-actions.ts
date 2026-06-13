'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';
import { createDeal } from '@/lib/actions/deals';
import { earnReviewDeal } from '@/lib/diligence';
import { OUTCOME_KINDS, type OutcomeKind } from '@/lib/earn/outcomes';
import type { Json } from '@/lib/supabase/database.types';

export type EarnActionResult =
  | { ok: true; message: string; href?: string }
  | { ok: false; error: string };

/**
 * Close the approve loop: the operator approved, it ran, and now it lands
 * everywhere it belongs. One approval fans out to (1) the trust-event stream —
 * the Chain-of-Trust audit row — and (2) the `earn_outcomes` ledger, which
 * carries that audit row's id as its provenance link. The outcome already
 * lives on its home surface (the underlying action wrote it there); the ledger
 * row records *where* so the operator can jump straight back to it.
 *
 * Best-effort: a record write must never undo or block the action the operator
 * already approved. The trust row surfaces in the Command Center activity feed;
 * the ledger row surfaces on `/earn`.
 */
async function recordApprovedOutcome(params: {
  orgId: string;
  actorId: string;
  entityType: string;
  entityId: string | null;
  /** trust_events.action — the audit verb. */
  action: string;
  /** earn_outcomes.kind — drives the ledger's row + chip. */
  kind: OutcomeKind;
  title: string;
  summary?: string | null;
  /** Where the outcome fanned out to. */
  homeSurface?: string | null;
  homeHref?: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = await createClient();

    // The Chain-of-Trust audit row first, so the ledger can link to it.
    const { data: trustRow } = await supabase
      .from('trust_events')
      .insert({
        org_id: params.orgId,
        actor_id: params.actorId,
        entity_type: params.entityType,
        entity_id: params.entityId,
        action: params.action,
        metadata: params.metadata as unknown as Json
      })
      .select('id')
      .single();

    // The compounding ledger row, carrying its provenance. `earn_outcomes` is
    // additive and not yet in the generated types — narrow typed escape insert.
    const ledger = supabase as unknown as {
      from: (table: string) => {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    };
    await ledger.from('earn_outcomes').insert({
      org_id: params.orgId,
      actor_id: params.actorId,
      kind: params.kind,
      specialist_slug: OUTCOME_KINDS[params.kind].specialistSlug,
      title: params.title,
      summary: params.summary ?? null,
      home_surface: params.homeSurface ?? null,
      home_href: params.homeHref ?? null,
      trust_event_id: trustRow?.id ?? null,
      entity_type: params.entityType,
      entity_id: params.entityId,
      metadata: params.metadata
    });
  } catch {
    // Best-effort — never block the approved action on its record rows.
  }
}

/**
 * Execute a tool action Earn proposed, after the operator confirmed it. Only
 * the mutating tools route here — `navigate` runs client-side. Each branch is
 * auth- and org-scoped and maps to an existing, audited server action, so Earn
 * can't do anything the operator couldn't do themselves.
 */
export async function executeEarnAction(
  name: string,
  input: Record<string, unknown>
): Promise<EarnActionResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, error: 'Sign in again to let Earn act for you.' };
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  if (name === 'create_deal') {
    const dealName = typeof input.name === 'string' ? input.name.trim() : '';
    if (!dealName) return { ok: false, error: 'A deal name is required.' };
    const stage = typeof input.stage === 'string' ? input.stage : undefined;
    const amount = typeof input.amount === 'number' ? input.amount : null;
    const res = await createDeal({ name: dealName, stage, amount });
    if (!res.ok) return { ok: false, error: res.error };
    await recordApprovedOutcome({
      orgId: org.orgId,
      actorId: user.id,
      entityType: 'deal',
      entityId: res.deal.id,
      action: 'earn_create_deal_approved',
      kind: 'deal_sourced',
      title: res.deal.name,
      summary: 'On-thesis deal added to your pipeline.',
      homeSurface: 'Deal Pipeline',
      homeHref: '/source/pipeline',
      metadata: { dealName: res.deal.name, stage: stage ?? null, amount }
    });
    revalidatePath('/source/pipeline');
    revalidatePath('/command-center');
    revalidatePath('/earn');
    return {
      ok: true,
      message: `Created “${res.deal.name}” in your pipeline.`,
      href: '/source/pipeline'
    };
  }

  if (name === 'run_diligence') {
    const dealId = typeof input.dealId === 'string' ? input.dealId : '';
    if (!dealId) {
      return {
        ok: false,
        error:
          'I need the specific deal. Open it on your Deal Pipeline, then ask me to run diligence.'
      };
    }
    const res = await earnReviewDeal({ orgId: org.orgId, createdBy: user.id, dealId });
    const convictionNote =
      res.conviction != null
        ? `Committee conviction ${res.conviction}/100.`
        : 'Committee review run.';
    await recordApprovedOutcome({
      orgId: org.orgId,
      actorId: user.id,
      entityType: 'diligence_run',
      entityId: res.runId,
      action: 'earn_run_diligence_approved',
      kind: 'diligence_run',
      title: 'Diligence committee review',
      summary: convictionNote,
      homeSurface: 'Diligence',
      homeHref: `/run/diligence/${res.runId}`,
      metadata: { dealId, conviction: res.conviction ?? null, status: res.status }
    });
    revalidatePath('/earn');
    if (res.status === 'complete') {
      const conviction = res.conviction != null ? ` — conviction ${res.conviction}/100` : '';
      return {
        ok: true,
        message: `The committee finished${conviction}. Memo posted.`,
        href: `/run/diligence/${res.runId}`
      };
    }
    return {
      ok: true,
      message: 'Diligence run started — review what came back.',
      href: `/run/diligence/${res.runId}`
    };
  }

  return { ok: false, error: `Earn can't run “${name}” yet.` };
}
