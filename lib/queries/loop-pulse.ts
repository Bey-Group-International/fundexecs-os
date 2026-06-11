import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LOOP_VERBS, type LoopVerb } from '@/lib/loop-chain';
import type { LoopEventRow } from '@/lib/loop-pulse';

/**
 * lib/queries/loop-pulse.ts — read the loop_events stream for the pulses.
 *
 * One RLS-scoped read of the org's recent events (the pulse window plus the
 * lookback the Run velocity pairing needs), newest first, bounded. Degrades
 * to an empty stream on any error — a hub never breaks because telemetry
 * couldn't be read. The pure aggregation lives in `lib/loop-pulse.ts`.
 */

/** How far back to read: the 30d window + lookback for velocity pairing. */
const LOOKBACK_DAYS = 90;
const MAX_ROWS = 500;

const VERB_SET = new Set<string>(LOOP_VERBS);

/** Load the org's recent loop events, mapped for the pulse aggregation. */
export async function getLoopEventRows(orgId: string): Promise<LoopEventRow[]> {
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('loop_events')
      .select('verb, event_type, entity_id, created_at, metadata')
      .eq('org_id', orgId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error || !data) return [];

    return data
      .filter((row) => VERB_SET.has(row.verb))
      .map((row) => ({
        verb: row.verb as LoopVerb,
        eventType: row.event_type,
        entityId: row.entity_id,
        createdAt: row.created_at,
        metadata:
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {}
      }));
  } catch (err) {
    console.warn('[loop-pulse] failed to read loop_events:', err);
    return [];
  }
}
