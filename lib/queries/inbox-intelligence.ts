import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  computeCalibration,
  type IntelligenceCalibration
} from '@/lib/queries/intelligence-calibration';

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
  /** Present on the `ai_judge` factor: Claude's calibrated 0-100 confidence. */
  confidence?: number | null;
  /** Adaptive multiplier the org's learning has applied to this factor. */
  multiplier?: number | null;
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

export interface IntelligenceBriefing {
  body: string;
  matchCount: number;
  topScore: number | null;
  generatedAt: string;
}

export interface InboxIntelligenceData {
  /** Org-scored signal matches (highest score first). */
  matches: SignalMatch[];
  /** Newest global market signals not (yet) routed into this org. */
  unroutedSignals: MarketSignal[];
  /** Total market signals visible (routed + unrouted). */
  signalCount: number;
  /** Self-aware read model: what the scorer has learned from past decisions. */
  calibration: IntelligenceCalibration;
  /** Latest Earn briefing for this org, when one has been generated. */
  briefing: IntelligenceBriefing | null;
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
      routedSpecialist: specialist,
      confidence: typeof r.confidence === 'number' ? r.confidence : null,
      multiplier: typeof r.multiplier === 'number' ? r.multiplier : null
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

  const calibration = computeCalibration(
    matches.map((m) => ({
      score: m.score,
      status: m.status,
      factors: m.factors.map((f) => ({ factor: f.factor, weight: f.weight }))
    }))
  );

  const briefing = await loadBriefing(supabase, orgId);

  return {
    matches,
    unroutedSignals,
    signalCount: signals.length,
    calibration,
    briefing,
    empty: matches.length === 0 && signals.length === 0
  };
}

/**
 * Read the org's current Earn briefing. `intelligence_briefings` is additive
 * and not yet in the generated types, so read through a narrow typed escape.
 */
async function loadBriefing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<IntelligenceBriefing | null> {
  const reader = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };

  try {
    const { data, error } = await reader
      .from('intelligence_briefings')
      .select('body, match_count, top_score, generated_at')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) {
      console.warn('[loadBriefing] failed to read intelligence_briefings:', error.message);
      return null;
    }
    if (!data || typeof data.body !== 'string') return null;
    return {
      body: data.body,
      matchCount: typeof data.match_count === 'number' ? data.match_count : 0,
      topScore: typeof data.top_score === 'number' ? data.top_score : null,
      generatedAt: typeof data.generated_at === 'string' ? data.generated_at : ''
    };
  } catch {
    return null;
  }
}
