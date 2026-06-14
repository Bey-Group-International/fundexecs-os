import 'server-only';
import { getConnectionsData } from '@/lib/queries/connections';
import { rankReconnects, type ReconnectResult } from '@/lib/intelligence/reconnect';

/* ============================================================================
 * lib/queries/reconnect.ts — surface the relationships that need re-engaging.
 *
 * Reuses the RLS-scoped `getConnectionsData` (no new schema), runs every
 * relationship through the Reconnect Engine, and returns the ranked at-risk set
 * with overdue / due-soon counts. Fail-soft to empty.
 * ========================================================================= */

export interface ReconnectList {
  items: ReconnectResult[];
  overdueCount: number;
  dueSoonCount: number;
}

const EMPTY: ReconnectList = { items: [], overdueCount: 0, dueSoonCount: 0 };

const MAX_ITEMS = 8;

export async function getReconnectList(orgId: string): Promise<ReconnectList> {
  try {
    const { rows } = await getConnectionsData(orgId);
    const ranked = rankReconnects(
      rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        company: r.company,
        strength: r.strength,
        status: r.status,
        interactionCount: r.interaction_count,
        lastInteractionAt: r.last_interaction_at
      }))
    );

    return {
      items: ranked.slice(0, MAX_ITEMS),
      overdueCount: ranked.filter((r) => r.band === 'Overdue').length,
      dueSoonCount: ranked.filter((r) => r.band === 'Due soon').length
    };
  } catch {
    return EMPTY;
  }
}
