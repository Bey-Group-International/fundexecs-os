/* ============================================================================
 * lib/tasklets/types — the PURE, icon-free vocabulary for the tasklet queue.
 *
 * A tasklet is the atomic unit of the firm's work (docs/EARN_LIFECYCLE_
 * EXPANSION.md §3): one real, observed signal → one routed, pre-shaped draft →
 * one operator approval → one provable `earn_outcomes` row. This module holds
 * only the render-safe shapes shared by the evaluator (server), the queue read
 * (server), and the queue UI (client) — no React / lucide imports, so it is
 * unit-testable and client-safe (same split discipline as lib/earn/outcomes).
 * ========================================================================= */

import type { OutcomeKind } from '@/lib/earn/outcomes';

/** Where a tasklet sits in its short life. */
export type TaskletStatus = 'pending' | 'approved' | 'dismissed';

/** The honest signal sources that arm tasklets — all operator-produced rows. */
export type TaskletSignalSource = 'inbox' | 'loop_event' | 'public_surface';

/**
 * A candidate tasklet produced by an evaluator from a real signal row. Pure
 * data — the queries layer attaches org/actor and upserts it idempotently on
 * `dedupeKey`.
 */
export interface TaskletDraft {
  /** Idempotency key, e.g. `inbox:<uuid>`. Unique per org. */
  dedupeKey: string;
  signalSource: TaskletSignalSource;
  /** Plain-language "why now" — stated honestly from the real row. */
  signalSummary: string;
  /** The outcome it will produce on approval (1:1 with earn_outcomes.kind). */
  kind: OutcomeKind;
  /** The desk that owns it, by roster slug. */
  specialistSlug: string;
  title: string;
  /** The approve-ready draft the operator reads before deciding. */
  draft: string;
  homeSurface: string | null;
  homeHref: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

/** A pending tasklet as the queue surfaces render it (specialist resolved). */
export interface Tasklet {
  id: string;
  signalSource: TaskletSignalSource;
  signalSummary: string | null;
  kind: OutcomeKind;
  /** The desk's display name (resolved from the roster), e.g. "Eleanor". */
  specialistName: string;
  specialistSlug: string;
  title: string;
  draft: string | null;
  homeSurface: string | null;
  homeHref: string | null;
  createdAt: string;
}
