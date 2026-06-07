import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/admin-metrics.ts — Admin platform-metrics loader.
 *
 * The Admin portal's Knowledge + Chain-of-Trust panels used to render fabricated
 * numbers ("15 / 15 embeddings", "pgvector Live", layer coverage 100/70/35/0).
 * This loader is the typed contract the UI binds to instead. It ships an HONEST
 * placeholder body today — `placeholder: true`, real values only where free
 * (the `ai_brains` catalogue count) — so the UI renders a clear "reference /
 * coming soon" state rather than faking progress.
 *
 * ── CONTRACT (Codex backend swaps the body, not the shape — see issue #115) ──
 * Real wiring sources `brains.embedded` from embedding coverage, `vector` from
 * the pgvector knowledge-chunks store, `intake` from the embedding/intake queue,
 * and `trust.layerCoverage` aggregated across the org's deal Chain-of-Trust
 * rows; it sets `placeholder: false`. Always resolves (never throws); RLS-scoped;
 * degrades to zeros + `placeholder: true` on error so the page never breaks.
 * ========================================================================= */

export type VectorStatus = 'live' | 'degraded' | 'unknown';
export type TrustLayerKey = 'truth' | 'concept' | 'execution' | 'work';

export interface AdminMetrics {
  /** AI brain catalogue: total modules + how many have embeddings. */
  brains: { total: number; embedded: number };
  /** pgvector knowledge store health + chunk count. */
  vector: { status: VectorStatus; chunks: number };
  /** Knowledge intake throughput. */
  intake: { queued: number; processed: number };
  /** 0–100 coverage per Chain-of-Trust layer across the org's deals. */
  trust: { layerCoverage: Record<TrustLayerKey, number> };
  /**
   * True while any panel is showing placeholder (not-yet-real) data. The UI
   * keys its "reference / coming soon" treatment off this flag. Flipped to
   * `false` by the Codex backend once every field is live.
   */
  placeholder: boolean;
}

const ZERO_COVERAGE: Record<TrustLayerKey, number> = {
  truth: 0,
  concept: 0,
  execution: 0,
  work: 0
};

function fallbackMetrics(): AdminMetrics {
  return {
    brains: { total: 0, embedded: 0 },
    vector: { status: 'unknown', chunks: 0 },
    intake: { queued: 0, processed: 0 },
    trust: { layerCoverage: { ...ZERO_COVERAGE } },
    placeholder: true
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function vectorStatus(value: unknown): VectorStatus {
  return value === 'live' || value === 'degraded' || value === 'unknown' ? value : 'unknown';
}

function normalizeMetrics(value: unknown): AdminMetrics {
  if (!value || typeof value !== 'object') return fallbackMetrics();
  const root = value as Record<string, unknown>;
  const brains = (root.brains ?? {}) as Record<string, unknown>;
  const vector = (root.vector ?? {}) as Record<string, unknown>;
  const intake = (root.intake ?? {}) as Record<string, unknown>;
  const trust = (root.trust ?? {}) as Record<string, unknown>;
  const layerCoverage = (trust.layerCoverage ?? {}) as Record<string, unknown>;

  return {
    brains: {
      total: numberOrZero(brains.total),
      embedded: numberOrZero(brains.embedded)
    },
    vector: {
      status: vectorStatus(vector.status),
      chunks: numberOrZero(vector.chunks)
    },
    intake: {
      queued: numberOrZero(intake.queued),
      processed: numberOrZero(intake.processed)
    },
    trust: {
      layerCoverage: {
        truth: numberOrZero(layerCoverage.truth),
        concept: numberOrZero(layerCoverage.concept),
        execution: numberOrZero(layerCoverage.execution),
        work: numberOrZero(layerCoverage.work)
      }
    },
    placeholder: root.placeholder === false ? false : true
  };
}

/**
 * Resolve admin platform metrics for an org. Real values come from the
 * RLS/member-gated `get_admin_metrics` RPC. Never throws; any DB/RPC issue
 * degrades to zeroed placeholders so the Admin page still renders honestly.
 */
export async function getAdminMetrics(orgId: string): Promise<AdminMetrics> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_admin_metrics', { _org_id: orgId });
    if (error) return fallbackMetrics();
    return normalizeMetrics(data);
  } catch {
    return fallbackMetrics();
  }
}
