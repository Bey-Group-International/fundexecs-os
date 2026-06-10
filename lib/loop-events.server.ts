import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { LoopVerb } from '@/lib/loop-chain';

/**
 * lib/loop-events.server.ts — the `loop_events` emitter (IO).
 *
 * Best-effort, append-only telemetry: one call appends one per-verb event via
 * the `log_loop_event` SECURITY DEFINER RPC (see migration 20260610090000).
 * Never throws and never blocks the caller's main path — instrumentation must
 * not be able to fail a close, an approval, or any other real action.
 */

export interface LoopEventInput {
  orgId: string;
  verb: LoopVerb;
  /** Short machine name, e.g. 'loop_closed'. */
  eventType: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** Emit one loop event. Best-effort: failures are logged, never surfaced. */
export async function emitLoopEvent(input: LoopEventInput): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('log_loop_event', {
      _org_id: input.orgId,
      _verb: input.verb,
      _event_type: input.eventType,
      _entity_type: input.entityType ?? undefined,
      _entity_id: input.entityId ?? undefined,
      _metadata: (input.metadata ?? {}) as never
    });
    if (error) {
      console.warn('[loop-events] emit failed:', error.message);
    }
  } catch (err) {
    console.warn('[loop-events] emit failed:', err);
  }
}
