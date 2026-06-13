'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { recordApprovedOutcome } from '@/lib/earn/record-outcome';
import { emitHighLevelEvent } from '@/lib/integrations/highlevel';
import { isOutcomeKind } from '@/lib/earn/outcomes';

/* ============================================================================
 * lib/tasklets/actions — the operator's two decisions on a tasklet.
 *
 * Draft-only: a tasklet never executes on its own. `approveTasklet` is the
 * single mutation, and it routes through the same approve-loop chokepoint Earn
 * uses (recordApprovedOutcome) — landing one `earn_outcomes` ledger row + one
 * `trust_events` audit row, then marking the tasklet approved with a soft link
 * to its proof. `dismissTasklet` simply retires it. Both are org-scoped through
 * RLS; a tasklet can only be decided by a member of its org, once.
 * ========================================================================= */

export type TaskletActionResult =
  | { ok: true; message: string; href?: string }
  | { ok: false; error: string };

interface PendingTaskletRow {
  id: string;
  kind: string;
  title: string;
  draft: string | null;
  signal_summary: string | null;
  home_surface: string | null;
  home_href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** Narrow typed escape over the not-yet-generated `tasklets` table. */
function taskletsTable(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          eq: (
            c: string,
            v: string
          ) => {
            maybeSingle: () => Promise<{ data: PendingTaskletRow | null }>;
          };
        };
      };
      update: (row: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: unknown }>;
      };
    };
  };
}

/**
 * Approve a tasklet: record its outcome to the ledger + Chain of Trust, then
 * mark it approved. Reuses `recordApprovedOutcome`, so a tasklet approval is
 * indistinguishable on the record from any other approved Earn action.
 */
export async function approveTasklet(taskletId: string): Promise<TaskletActionResult> {
  if (!taskletId) return { ok: false, error: 'Missing tasklet.' };
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const table = taskletsTable(supabase);

  const { data: row } = await table
    .from('tasklets')
    .select(
      'id, kind, title, draft, signal_summary, home_surface, home_href, entity_type, entity_id, metadata'
    )
    .eq('id', taskletId)
    .eq('status', 'pending')
    .maybeSingle();

  if (!row) return { ok: false, error: 'That tasklet was already handled.' };
  if (!isOutcomeKind(row.kind)) return { ok: false, error: 'Unrecognized tasklet kind.' };

  const trustEventId = await recordApprovedOutcome({
    orgId: org.orgId,
    actorId: org.userId,
    entityType: row.entity_type ?? 'tasklet',
    entityId: row.entity_id,
    action: `earn_tasklet_${row.kind}_approved`,
    kind: row.kind,
    title: row.title,
    summary: row.draft ?? row.signal_summary,
    homeSurface: row.home_surface,
    homeHref: row.home_href,
    metadata: { ...(row.metadata ?? {}), taskletId: row.id, source: 'tasklet' }
  });

  const { error: updateError } = await table
    .from('tasklets')
    .update({
      status: 'approved',
      decided_by: org.userId,
      decided_at: new Date().toISOString(),
      outcome_trust_event_id: trustEventId
    })
    .eq('id', taskletId);

  if (updateError) {
    return { ok: false, error: 'Could not approve tasklet.' };
  }

  // Module 1: warmth-threshold tasklets carry hlEnroll:true — fire HL on approval.
  // Only emits after the DB update is confirmed, so HL is never notified of a failed approval.
  if (row.metadata?.hlEnroll === true) {
    void emitHighLevelEvent({
      type: 'inbox_warmth_enrolled',
      occurredAt: new Date().toISOString(),
      data: {
        inboxItemId: row.entity_id,
        contactId: row.metadata.contactId ?? null,
        dealId: row.metadata.dealId ?? null,
        score: row.metadata.score ?? null,
        channel: row.metadata.channel ?? null,
        taskletId: row.id,
        title: row.title
      }
    });
  }

  revalidatePath('/earn');
  revalidatePath('/command-center');

  return {
    ok: true,
    message: `Approved — ${row.title} is on your Earn ledger.`,
    href: row.home_href ?? '/earn'
  };
}

/** Dismiss a tasklet — retire it without producing an outcome. */
export async function dismissTasklet(taskletId: string): Promise<TaskletActionResult> {
  if (!taskletId) return { ok: false, error: 'Missing tasklet.' };
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  await taskletsTable(supabase)
    .from('tasklets')
    .update({
      status: 'dismissed',
      decided_by: org.userId,
      decided_at: new Date().toISOString()
    })
    .eq('id', taskletId);

  revalidatePath('/command-center');
  return { ok: true, message: 'Dismissed.' };
}
