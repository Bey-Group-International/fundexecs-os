// lib/inference/router.ts
// The capability-based model router. Pure + tested. Given a policy and the set of
// available providers/models, it picks the best model — or returns null when
// nothing satisfies the hard constraints (so the caller degrades rather than
// silently using an inappropriate model).
//
// Hard filters (a model is excluded if it fails any): provider available;
// capability supported; restricted data → private deployment or an allowed
// region; region → the model may process there; context fits the window; cost
// under the ceiling. Ranking among survivors: preferred tier first, then
// sensitivity-aware tier bias (restricted/high-assurance work prefers stronger
// models), then lower cost, then larger context.

import type { ModelSpec, RoutableProvider, RouteDecision, RoutePolicy } from "./types";

const TIER_RANK: Record<ModelSpec["tier"], number> = { fast: 0, balanced: 1, high_assurance: 2 };

function passesHardFilters(m: ModelSpec, policy: RoutePolicy): boolean {
  if (policy.capability && !m.capabilities.includes(policy.capability)) return false;

  if (policy.sensitivity === "restricted") {
    // Restricted data may only go to a private deployment or a region-scoped model.
    const regionOk = policy.region && m.regions?.includes(policy.region);
    if (!m.privateDeployment && !regionOk) return false;
  }

  if (policy.region && m.regions && !m.regions.includes(policy.region)) return false;

  if (policy.contextTokens != null && policy.contextTokens > m.contextTokens) return false;

  if (
    policy.costCeilingPer1kOutput != null &&
    m.costPer1kOutput != null &&
    m.costPer1kOutput > policy.costCeilingPer1kOutput
  ) {
    return false;
  }

  return true;
}

// Higher score = better fit for the policy.
function score(m: ModelSpec, policy: RoutePolicy): number {
  let s = 0;
  if (policy.preferTier && m.tier === policy.preferTier) s += 100;
  // Restricted / high-assurance work biases toward stronger tiers; everything
  // else biases toward the cheaper/faster end unless a tier was requested.
  if (policy.sensitivity === "restricted" || policy.capability === "high_assurance_review") {
    s += TIER_RANK[m.tier] * 10;
  } else if (!policy.preferTier) {
    s += (2 - TIER_RANK[m.tier]) * 5; // prefer fast/balanced when unconstrained
  }
  // Cheaper output is better (small nudge).
  if (m.costPer1kOutput != null) s += Math.max(0, 5 - m.costPer1kOutput);
  return s;
}

/**
 * Select the best (provider, model) for a policy, or null when nothing qualifies.
 * Deterministic: ties broken by provider key then model id so routing is stable.
 */
export function selectRoute(policy: RoutePolicy, providers: RoutableProvider[]): RouteDecision | null {
  const candidates: Array<{ provider: string; model: ModelSpec; s: number }> = [];

  for (const p of providers) {
    if (!p.available) continue;
    for (const m of p.models) {
      if (!passesHardFilters(m, policy)) continue;
      candidates.push({ provider: p.key, model: m, s: score(m, policy) });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) =>
      b.s - a.s ||
      a.provider.localeCompare(b.provider) ||
      a.model.id.localeCompare(b.model.id),
  );

  const best = candidates[0];
  const reason =
    `Selected ${best.model.id} (${best.model.tier}) on ${best.provider}` +
    (policy.capability ? ` for ${policy.capability}` : "") +
    (policy.sensitivity ? ` [${policy.sensitivity}]` : "") +
    ".";
  return { provider: best.provider, model: best.model, reason };
}
