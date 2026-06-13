import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getMember } from '@/lib/team/roster';
import { isOutcomeKind } from '@/lib/earn/outcomes';
import {
  inboxTasklets,
  loopEventTasklets,
  submissionTasklets,
  interestTasklets,
  type InboxSignalRow,
  type LoopSignalRow,
  type DealSubmissionRow,
  type DealInterestRow
} from './evaluate';
import type { Tasklet, TaskletDraft, TaskletSignalSource } from './types';

/* ============================================================================
 * lib/tasklets/queries — the tasklet queue's read + refresh surface.
 *
 * `refreshTasklets` evaluates the three honest signal sources the operator
 * already produces and idempotently upserts one pending tasklet per observed
 * signal (unique on dedupe_key). There is no scheduler yet, so the refresh runs
 * on view — the dock and the command center call `getTaskletQueue`, which
 * refreshes then reads. Every read fails OPEN to an empty queue so a signal
 * table that isn't wired yet never breaks the shell.
 *
 * `tasklets` and the public-funnel tables aren't in the generated Supabase
 * types yet, so reads/writes go through narrow typed escapes (same pattern as
 * earn-outcomes.ts / inbox.ts).
 * ========================================================================= */

/** How many recent rows per source we evaluate on each refresh. */
const SCAN_LIMIT = 25;

interface AnyRow {
  [key: string]: unknown;
}

/** Narrow typed escape: read recent rows from a not-yet-generated table. */
async function scan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  cols: string,
  orgId: string | null,
  orderCol: string
): Promise<AnyRow[]> {
  try {
    const reader = supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            col: string,
            val: string
          ) => {
            order: (
              c: string,
              o: { ascending: boolean }
            ) => { limit: (n: number) => Promise<{ data: AnyRow[] | null }> };
          };
          order: (
            c: string,
            o: { ascending: boolean }
          ) => { limit: (n: number) => Promise<{ data: AnyRow[] | null }> };
        };
      };
    };
    const base = reader.from(table).select(cols);
    const q = orgId ? base.eq('org_id', orgId) : base;
    const { data } = await q.order(orderCol, { ascending: false }).limit(SCAN_LIMIT);
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Evaluate every honest signal source for the org and upsert the resulting
 * approve-ready tasklets. Idempotent: the unique (org_id, dedupe_key) index +
 * ignoreDuplicates means re-running never duplicates, and a decided tasklet
 * (approved/dismissed) never resurfaces because its key stays on the record.
 */
export async function refreshTasklets(orgId: string): Promise<void> {
  const supabase = await createClient();

  // Public-funnel tables are global (no org_id); deal_interest_captures has no
  // org column either, so they scan unscoped and we cap them tight.
  const [inboxRows, loopRows, submissionRows, interestRows] = await Promise.all([
    scan(
      supabase,
      'inbox_items',
      'id, channel, direction, subject, preview, draft_reply, contact_id, deal_id',
      orgId,
      'created_at'
    ),
    scan(
      supabase,
      'loop_events',
      'id, verb, event_type, entity_type, entity_id',
      orgId,
      'created_at'
    ),
    scan(
      supabase,
      'deal_submissions',
      'id, company_name, stage, raise_amount, founder_name, founder_email, status',
      null,
      'created_at'
    ),
    scan(supabase, 'deal_interest_captures', 'id, deal_id, name, email, note', null, 'created_at')
  ]);

  const drafts: TaskletDraft[] = [
    ...inboxTasklets(inboxRows as unknown as InboxSignalRow[]),
    ...loopEventTasklets(loopRows as unknown as LoopSignalRow[]),
    ...submissionTasklets(submissionRows as unknown as DealSubmissionRow[]),
    ...interestTasklets(interestRows as unknown as DealInterestRow[])
  ];

  if (drafts.length === 0) return;

  const rows = drafts.map((d) => ({
    org_id: orgId,
    status: 'pending',
    signal_source: d.signalSource,
    dedupe_key: d.dedupeKey,
    kind: d.kind,
    specialist_slug: d.specialistSlug,
    title: d.title,
    draft: d.draft,
    signal_summary: d.signalSummary,
    home_surface: d.homeSurface,
    home_href: d.homeHref,
    entity_type: d.entityType,
    entity_id: d.entityId,
    metadata: d.metadata
  }));

  try {
    const writer = supabase as unknown as {
      from: (t: string) => {
        upsert: (
          rows: Record<string, unknown>[],
          opts: { onConflict: string; ignoreDuplicates: boolean }
        ) => Promise<{ error: unknown }>;
      };
    };
    await writer
      .from('tasklets')
      .upsert(rows, { onConflict: 'org_id,dedupe_key', ignoreDuplicates: true });
  } catch {
    // Best-effort — a failed refresh just means an empty/older queue this view.
  }
}

interface TaskletRow {
  id: string;
  signal_source: string;
  signal_summary: string | null;
  kind: string;
  specialist_slug: string;
  title: string;
  draft: string | null;
  home_surface: string | null;
  home_href: string | null;
  created_at: string;
}

function isSignalSource(v: string): v is TaskletSignalSource {
  return v === 'inbox' || v === 'loop_event' || v === 'public_surface';
}

function toTasklet(r: TaskletRow): Tasklet | null {
  if (!isOutcomeKind(r.kind) || !isSignalSource(r.signal_source)) return null;
  const member = getMember(r.specialist_slug);
  return {
    id: r.id,
    signalSource: r.signal_source,
    signalSummary: r.signal_summary,
    kind: r.kind,
    specialistName: member ? member.name.split(/\s+/)[0]! : 'Earn',
    specialistSlug: r.specialist_slug,
    title: r.title,
    draft: r.draft,
    homeSurface: r.home_surface,
    homeHref: r.home_href,
    createdAt: r.created_at
  };
}

/** Read the org's pending tasklets — newest first. Fails open to empty. */
export async function getPendingTasklets(orgId: string): Promise<Tasklet[]> {
  const supabase = await createClient();
  try {
    const reader = supabase as unknown as {
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
              order: (
                c: string,
                o: { ascending: boolean }
              ) => { limit: (n: number) => Promise<{ data: TaskletRow[] | null }> };
            };
          };
        };
      };
    };
    const { data } = await reader
      .from('tasklets')
      .select(
        'id, signal_source, signal_summary, kind, specialist_slug, title, draft, home_surface, home_href, created_at'
      )
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    return (data ?? []).map(toTasklet).filter((t): t is Tasklet => t !== null);
  } catch {
    return [];
  }
}

/** Refresh from live signals, then read the pending queue. The view entrypoint. */
export async function getTaskletQueue(orgId: string): Promise<Tasklet[]> {
  await refreshTasklets(orgId);
  return getPendingTasklets(orgId);
}
