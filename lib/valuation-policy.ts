// Valuation policy & freshness — the 409A-style discipline Carta enforces for
// fair value: a stated re-mark cadence, which method backed each mark, and which
// holdings have gone stale against the policy. Pure & dependency-free over the
// existing valuation_marks; no schema change.

export interface MarkLike {
  asset_id: string;
  as_of: string;
  method: string | null;
}

export interface AssetLike {
  id: string;
  name: string;
}

export interface AssetFreshness {
  assetId: string;
  name: string;
  lastMark: string | null; // ISO date of newest mark
  method: string | null;
  daysSince: number | null; // null = never marked
  stale: boolean; // past cadence (or never marked)
}

export interface MethodCount {
  method: string;
  count: number;
}

export interface ValuationPolicy {
  cadenceDays: number;
  assets: AssetFreshness[];
  markedCount: number; // assets with ≥1 mark
  total: number;
  coveragePct: number; // marked / total
  staleCount: number; // stale or never-marked held assets
  methods: MethodCount[]; // method usage across marks
  nextDue: string | null; // soonest as-of among non-stale that will lapse first
}

const QUARTERLY = 90;

function daysBetween(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((now - t) / 86_400_000);
}

/**
 * Assess held assets against a re-mark cadence (default quarterly). For each, the
 * newest mark, its method, and whether it's lapsed. Never-marked assets count as
 * stale — they have no fair value on record.
 */
export function assessValuationPolicy(
  assets: AssetLike[],
  marks: MarkLike[],
  cadenceDays: number = QUARTERLY,
  now: number = Date.now(),
): ValuationPolicy {
  const latestByAsset = new Map<string, MarkLike>();
  for (const m of marks) {
    const cur = latestByAsset.get(m.asset_id);
    if (!cur || m.as_of > cur.as_of) latestByAsset.set(m.asset_id, m);
  }

  const freshness: AssetFreshness[] = assets.map((a) => {
    const latest = latestByAsset.get(a.id) ?? null;
    const daysSince = latest ? daysBetween(latest.as_of, now) : null;
    return {
      assetId: a.id,
      name: a.name,
      lastMark: latest?.as_of ?? null,
      method: latest?.method ?? null,
      daysSince,
      stale: daysSince == null || daysSince > cadenceDays,
    };
  });
  // Stalest first so the work-to-do floats up; never-marked sort to the top.
  freshness.sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));

  const methodMap = new Map<string, number>();
  for (const m of marks) {
    const k = (m.method ?? "unspecified").trim() || "unspecified";
    methodMap.set(k, (methodMap.get(k) ?? 0) + 1);
  }
  const methods = [...methodMap.entries()]
    .map(([method, count]) => ({ method, count }))
    .sort((a, b) => b.count - a.count);

  const marked = freshness.filter((f) => f.lastMark != null);
  // Next mark to lapse: among fresh assets, the one whose last mark is oldest.
  const nextDue = marked.filter((f) => !f.stale).map((f) => f.lastMark!).sort()[0] ?? null;

  return {
    cadenceDays,
    assets: freshness,
    markedCount: marked.length,
    total: assets.length,
    coveragePct: assets.length ? Math.round((marked.length / assets.length) * 100) : 0,
    staleCount: freshness.filter((f) => f.stale).length,
    methods,
    nextDue,
  };
}
