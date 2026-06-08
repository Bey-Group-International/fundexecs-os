/**
 * lib/loop-close.ts — the "close the loop" flywheel logic (pure).
 *
 * Phase 2 of the operating-loop fortification: when a real execution event
 * happens in DRIVE (a deal closes, a diligence run completes, capital closes),
 * proof flows back into BUILD — the operator's Chain-of-Trust record — so their
 * readiness rises and the next raise is easier. Drive → Build is the flywheel.
 *
 * This module is the deterministic, side-effect-free core: which proof layer an
 * execution event strengthens, and by how much. The server action in
 * `lib/actions/loop.ts` does the IO (idempotent ledger write + proof bump).
 * Keeping the mapping pure means it reads the same everywhere and is trivial to
 * reason about. UI metadata + math only — no imports from loaders or Supabase.
 */

/** The execution events that close the loop. */
export type LoopCloseSource = 'deal_closed' | 'diligence_completed' | 'capital_closed';

/** The four Chain-of-Trust proof layers, short keys. */
export type ProofLayerKey = 'truth' | 'concept' | 'execution' | 'work';

/** Human label for each proof layer (matches `proof_layers.layer_name`). */
export const PROOF_LAYER_LABEL: Record<ProofLayerKey, string> = {
  truth: 'Proof of Truth',
  concept: 'Proof of Concept',
  execution: 'Proof of Execution',
  work: 'Proof of Work'
};

/**
 * Which member proof layer each execution event strengthens. Completed
 * diligence is proof of *execution*; a closed deal or deployed capital is proof
 * of *work* (you didn't just analyze — you shipped).
 */
export const LOOP_SOURCE_LAYER: Record<LoopCloseSource, ProofLayerKey> = {
  diligence_completed: 'execution',
  deal_closed: 'work',
  capital_closed: 'work'
};

/**
 * Bounded contribution (percentage points) each execution event adds to its
 * layer. This is the "execution proof" signal made explicit: real execution
 * — not just human-approved evidence — now feeds the proof layer (and thus
 * readiness). Weights are deliberately partial so a single event advances the
 * record without claiming the layer is complete; multiple closes compound
 * toward 100.
 */
export const LOOP_SOURCE_WEIGHT: Record<LoopCloseSource, number> = {
  diligence_completed: 20,
  deal_closed: 25,
  capital_closed: 25
};

/**
 * Apply one execution event's contribution to a layer's current completion,
 * clamped to 0–100. Idempotency is enforced upstream (one credit per entity via
 * the append-only `trust_events` ledger), so this is a straight additive bump.
 */
export function applyLoopContribution(current: number, source: LoopCloseSource): number {
  const base = Number.isFinite(current) ? current : 0;
  return Math.max(0, Math.min(100, Math.round(base + LOOP_SOURCE_WEIGHT[source])));
}

/** Short, human phrase for the event — used in trust-event metadata + UI. */
export const LOOP_SOURCE_LABEL: Record<LoopCloseSource, string> = {
  deal_closed: 'Deal closed',
  diligence_completed: 'Diligence completed',
  capital_closed: 'Capital closed'
};
