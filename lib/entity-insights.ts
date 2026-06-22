// lib/entity-insights.ts
// The Entity workspace's "lead with what matters" layer: a quick read on the
// firm's structure and ownership health — vehicle mix, stakeholder coverage,
// ownership-balance alerts, and concentration. Pure — unit-tested, reused by the
// overview header.
import { rollupOwnership } from "@/lib/entity-ownership";
import type { EquityHolding } from "@/lib/supabase/database.types";

export interface EntityInsights {
  entityCount: number;
  stakeholderCount: number;
  unlinkedStakeholders: number;
  byType: { type: string; count: number }[];
  /** Entities whose holdings don't sum to ~100% (need attention). */
  imbalanced: { entityId: string; name: string; totalPct: number }[];
  /** Highest single-holder concentration across entities. */
  topConcentration: { entityName: string; pct: number } | null;
  entitiesWithCapTable: number;
}

export function computeEntityInsights(
  entities: { id: string; name: string; entity_type: string }[],
  stakeholders: { principal_id: string | null; investor_id: string | null }[],
  holdings: EquityHolding[],
): EntityInsights {
  const byTypeMap = new Map<string, number>();
  for (const e of entities) byTypeMap.set(e.entity_type, (byTypeMap.get(e.entity_type) ?? 0) + 1);
  const byType = [...byTypeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const unlinkedStakeholders = stakeholders.filter((s) => !s.principal_id && !s.investor_id).length;

  const imbalanced: EntityInsights["imbalanced"] = [];
  let topConcentration: EntityInsights["topConcentration"] = null;
  let entitiesWithCapTable = 0;

  for (const e of entities) {
    const hs = holdings.filter((h) => h.entity_id === e.id);
    if (hs.length === 0) continue;
    entitiesWithCapTable += 1;
    const r = rollupOwnership(hs, [], []);
    if (!r.balanced) imbalanced.push({ entityId: e.id, name: e.name, totalPct: r.totalPct });
    if (!topConcentration || r.topHolderPct > topConcentration.pct) {
      topConcentration = { entityName: e.name, pct: r.topHolderPct };
    }
  }

  return {
    entityCount: entities.length,
    stakeholderCount: stakeholders.length,
    unlinkedStakeholders,
    byType,
    imbalanced,
    topConcentration,
    entitiesWithCapTable,
  };
}
