import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/audit.ts — Audit Trail surface loader.
 *
 * Merges three event sources into a single chronological timeline:
 *   1. trust_events   — Chain-of-Trust record mutations (entity-level)
 *   2. admin_actions  — Platform-level admin operations (org-scoped)
 *   3. diligence_findings — AI analyst findings from diligence runs
 *
 * Claude's backend wires the `getAuditData` loader to the authenticated org
 * and may extend the shape. The UI binds to these typed contracts and falls
 * back gracefully when the loader is not yet wired (empty arrays).
 * ========================================================================= */

export type AuditEventKind = 'trust' | 'admin' | 'diligence';

export interface AuditEvent {
  id: string;
  kind: AuditEventKind;
  /** ISO timestamp */
  timestamp: string;
  /** Human-readable action label */
  action: string;
  /** Entity or target type (e.g. "deal", "contact", "org") */
  entityType: string | null;
  /** FK to the affected entity */
  entityId: string | null;
  /** Actor display name or ID */
  actor: string | null;
  /** Free-form metadata blob for detail expansion */
  meta: Record<string, unknown>;
  /** For diligence findings: the AI agent name */
  agent?: string;
  /** For diligence findings: conviction score 0-100 */
  score?: number | null;
  /** For diligence findings: summary text */
  summary?: string;
}

export interface AuditData {
  events: AuditEvent[];
  empty: boolean;
}

export async function getAuditData(orgId: string): Promise<AuditData> {
  const supabase = await createClient();

  const [trustResult, adminResult, diligenceResult] = await Promise.all([
    supabase
      .from('trust_events')
      .select('id, action, actor_id, created_at, entity_id, entity_type, metadata')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100),

    supabase
      .from('admin_actions')
      .select('id, action_type, admin_user_id, created_at, target_id, target_type, metadata')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50),

    supabase
      .from('diligence_findings')
      .select('id, agent, summary, score, created_at, run_id')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  const trustEvents: AuditEvent[] = (trustResult.data ?? []).map((e) => ({
    id: e.id,
    kind: 'trust' as const,
    timestamp: e.created_at,
    action: e.action,
    entityType: e.entity_type,
    entityId: e.entity_id,
    actor: e.actor_id,
    meta: (e.metadata as Record<string, unknown>) ?? {}
  }));

  const adminEvents: AuditEvent[] = (adminResult.data ?? []).map((e) => ({
    id: e.id,
    kind: 'admin' as const,
    timestamp: e.created_at,
    action: e.action_type,
    entityType: e.target_type,
    entityId: e.target_id,
    actor: e.admin_user_id,
    meta: (e.metadata as Record<string, unknown>) ?? {}
  }));

  const diligenceEvents: AuditEvent[] = (diligenceResult.data ?? []).map((e) => ({
    id: e.id,
    kind: 'diligence' as const,
    timestamp: e.created_at,
    action: `Diligence finding: ${e.agent}`,
    entityType: 'diligence_run',
    entityId: e.run_id,
    actor: null,
    meta: {},
    agent: e.agent,
    score: e.score,
    summary: e.summary
  }));

  // Merge and sort all events newest-first
  const events: AuditEvent[] = [...trustEvents, ...adminEvents, ...diligenceEvents].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return { events, empty: events.length === 0 };
}
