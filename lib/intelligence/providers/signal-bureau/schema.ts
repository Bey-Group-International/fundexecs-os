// lib/intelligence/providers/signal-bureau/schema.ts
// The Signal Bureau wire shapes — the ONLY module in FundExecs that knows the
// `sb.signals.v1` payload. Everything else consumes the neutral
// ProviderObservation the adapter emits. Keeping the provider schema quarantined
// here is the anti-corruption boundary: a provider schema change touches this
// file + the adapter, and nothing in FundExecs business logic.
//
// Fields are deliberately permissive (mostly optional + an index signature): an
// ADDITIVE provider change (a new field) must never break ingestion — the
// adapter preserves unknown fields in rawPayload and emits schema-drift
// telemetry rather than throwing.

export const SB_SCHEMA_VERSION = "sb.signals.v1";

/** A source receipt Signal Bureau attaches to evidence-backed signals. */
export interface SbReceipt {
  url?: string;
  title?: string;
  published_at?: string;
  [k: string]: unknown;
}

/** One Signal Bureau signal, as returned by GET /api/signals. */
export interface SbSignal {
  id?: string;
  schema_version?: string;
  /** Primary subject + any co-mentioned entities. */
  entity?: string;
  entities?: Array<string | { name?: string; type?: string; relationship?: string; [k: string]: unknown }>;
  headline?: string;
  title?: string;
  summary?: string;
  narrative?: string;
  category?: string;
  signal_type?: string;
  /** Proprietary trajectory — a string band or a numeric velocity. */
  trajectory?: string;
  velocity?: number;
  acceleration?: number;
  /** Evidence: receipts present ⇒ receipted; a corroborated flag ⇒ corroborated. */
  receipts?: SbReceipt[];
  evidence_status?: string;
  corroborated?: boolean;
  /** 0–1 or 0–100 provider confidence (adapter normalizes the scale). */
  confidence?: number;
  score?: number;
  /** The provider's own as-of + observation stamps. */
  as_of?: string;
  observed_at?: string;
  detected_at?: string;
  /** Convenience source links (in addition to receipts). */
  sources?: string[];
  urls?: string[];
  /** Forward-looking horizon for unfolding/future events. */
  horizon?: string;
  expires_at?: string;
  // Unknown/additive fields are tolerated and preserved.
  [k: string]: unknown;
}

/** GET /api/signals envelope. */
export interface SbSignalsResponse {
  signals?: SbSignal[];
  data?: SbSignal[];
  schema_version?: string;
  as_of?: string;
  [k: string]: unknown;
}

/** POST /api/ask response — future-event / scenario answer. */
export interface SbAskResponse {
  answer?: string;
  evidence_status?: string;
  confidence?: number;
  as_of?: string;
  sources?: string[];
  [k: string]: unknown;
}

/** GET /api/stats — provider calibration / methodology disclosure. */
export interface SbStatsResponse {
  calibration?: { reliability?: number; hit_rate?: number; [k: string]: unknown };
  reliability?: number;
  methodology?: string;
  as_of?: string;
  [k: string]: unknown;
}

/** The set of top-level keys the adapter recognizes on a signal. */
export const KNOWN_SB_SIGNAL_KEYS: ReadonlySet<string> = new Set([
  "id",
  "schema_version",
  "entity",
  "entities",
  "headline",
  "title",
  "summary",
  "narrative",
  "category",
  "signal_type",
  "trajectory",
  "velocity",
  "acceleration",
  "receipts",
  "evidence_status",
  "corroborated",
  "confidence",
  "score",
  "as_of",
  "observed_at",
  "detected_at",
  "sources",
  "urls",
  "horizon",
  "expires_at",
]);
