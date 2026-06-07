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

/**
 * Resolve admin platform metrics for an org. Today: an honest placeholder with
 * the real brain count filled in where it's free; everything else zeroed and
 * `placeholder: true`. Never throws.
 */
export async function getAdminMetrics(orgId: string): Promise<AdminMetrics> {
  let brainsTotal = 0;
  try {
    const supabase = await createClient();
    // Real + free: count the brains this org can see (global + org-scoped).
    const { count } = await supabase
      .from('ai_brains')
      .select('id', { count: 'exact', head: true })
      .or(`is_global.eq.true,org_id.eq.${orgId}`);
    brainsTotal = count ?? 0;
  } catch {
    brainsTotal = 0;
  }

  return {
    brains: { total: brainsTotal, embedded: 0 },
    vector: { status: 'unknown', chunks: 0 },
    intake: { queued: 0, processed: 0 },
    trust: { layerCoverage: { ...ZERO_COVERAGE } },
    // Real metrics are a backend task (#115); until then the UI shows a clear
    // "reference / coming soon" state rather than fabricated numbers.
    placeholder: true
  };
}
