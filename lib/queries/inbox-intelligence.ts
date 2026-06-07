import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/inbox-intelligence.ts — Inbox Intelligence read surface loader.
 *
 * Read-only over two live tables:
 *   - `market_signals`  — global capital-market intelligence (EDGAR Form D /
 *     Form ADV and future low-cost sources). Newest first, carries a routed
 *     specialist + severity.
 *   - `matches` (kind = 'signal')  — the org-scoped, scored routing of those
 *     signals into this org's inbox, produced by `generate_signal_matches`.
 *     Each row carries a 0-100 score and an explainable rationale array.
 *
 * No ingestion, no cron, no writes. The tables are empty until ingestion runs
 * elsewhere — the UI renders a tasteful empty state in that case. The signal
 * scorer routes to specialists by first name (e.g. "eleanor"); we keep that
 * raw value and let the view resolve it against the team roster.
 * ========================================================================= */

export type SignalSeverity = 'critical' | 'warning' | 'info' | string;

export interface MarketSignal {
  id: string;
  source: string;
  sourceExternalId: string | null;
  kind: string;
  severity: SignalSeverity;
  routedSpecialist: string | null;
  capturedAt: string;
  occurredAt: string | null;
  /** Normalized projection of the raw payload (issuer name, amount, etc.). */
  normalized: Record<string, unknown>;
}

export interface SignalRationaleFactor {
  factor: string;
  weight: number;
  detail: string;
  routedSpecialist?: string | null;
}

export interface SignalMatch {
  id: string;
  subjectId: string;
  score: number;
  status: string;
  createdAt: string;
  /** Parsed rationale factors (best-effort; tolerant of shape drift). */
  factors: SignalRationaleFactor[];
  /** Specialist resolved from the rationale, when present. */
  routedSpecialist: string | null;
  /** The market signal this match points at, when joinable. */
  signal: MarketSignal | null;
}

export interface InboxIntelligenceData {
  /** Org-scored signal matches (highest score first). */
  matches: SignalMatch[];
  /** Newest global market signals not (yet) routed into this org. */
  unroutedSignals: MarketSignal[];
  /** Total market signals visible (routed + unrouted). */
  signalCount: number;
  empty: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapSignal(row: {
  id: string;
  source: string;
  source_external_id: string | null;
  kind: string;
  severity: string;
  routed_specialist: string | null;
  captured_at: string;
  occurred_at: string | null;
  normalized: unknown;
}): MarketSignal {
  return {
    id: row.id,
    source: row.source,
    sourceExternalId: row.source_external_id,
    kind: row.kind,
    severity: row.severity,
    routedSpecialist: row.routed_specialist,
    capturedAt: row.captured_at,
    occurredAt: row.occurred_at,
    normalized: asRecord(row.normalized)
  };
}

/** Parse the `matches.rationale` jsonb array into typed factors. */
function parseFactors(rationale: unknown): SignalRationaleFactor[] {
  if (!Array.isArray(rationale)) return [];
  const out: SignalRationaleFactor[] = [];
  for (const entry of rationale) {
    const r = asRecord(entry);
    if (typeof r.factor !== 'string') continue;
    const matchedFields = asRecord(r.matched_fields);
    const specialist =
      typeof r.routed_specialist === 'string'
        ? r.routed_specialist
        : typeof matchedFields.routed_specialist === 'string'
          ? (matchedFields.routed_specialist as string)
          : null;
    out.push({
      factor: r.factor,
      weight: typeof r.weight === 'number' ? r.weight : 0,
      detail: typeof r.detail === 'string' ? r.detail : '',
      routedSpecialist: specialist
    });
  }
  return out;
}

function specialistFromFactors(factors: SignalRationaleFactor[]): string | null {
  const routing = factors.find((f) => f.factor === 'routing' && f.routedSpecialist);
  if (routing?.routedSpecialist) return routing.routedSpecialist;
  const any = factors.find((f) => f.routedSpecialist);
  return any?.routedSpecialist ?? null;
}

export async function getInboxIntelligenceData(orgId: string): Promise<InboxIntelligenceData> {
  const supabase = await createClient();

  const [matchResult, signalResult] = await Promise.all([
    supabase
      .from('matches')
      .select('id, subject_id, score, status, rationale, created_at')
      .eq('org_id', orgId)
      .eq('kind', 'signal')
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100),

    supabase
      .from('market_signals')
      .select(
        'id, source, source_external_id, kind, severity, routed_specialist, captured_at, occurred_at, normalized'
      )
      .order('captured_at', { ascending: false })
      .limit(100)
  ]);

  const signals = (signalResult.data ?? []).map(mapSignal);
  const signalById = new Map(signals.map((s) => [s.id, s] as const));

  const matches: SignalMatch[] = (matchResult.data ?? []).map((r) => {
    const factors = parseFactors(r.rationale);
    return {
      id: r.id,
      subjectId: r.subject_id,
      score: r.score,
      status: r.status,
      createdAt: r.created_at,
      factors,
      routedSpecialist: specialistFromFactors(factors),
      signal: signalById.get(r.subject_id) ?? null
    };
  });

  const routedSignalIds = new Set(matches.map((m) => m.subjectId));
  const unroutedSignals = signals.filter((s) => !routedSignalIds.has(s.id));

  return {
    matches,
    unroutedSignals,
    signalCount: signals.length,
    empty: matches.length === 0 && signals.length === 0
  };
}
