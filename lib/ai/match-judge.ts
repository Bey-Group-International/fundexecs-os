import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { AI_MODELS } from './models';

/* ============================================================================
 * lib/ai/match-judge.ts — Claude weighs in on a signal match.
 *
 * The deterministic scorer produces the 0-100 score + factor rationale. This
 * layer asks the routed specialist (via Claude) to give a second opinion: a
 * calibrated confidence and one or two sentences on whether the match is worth
 * the operator's time. The verdict is appended to the match's rationale array
 * as an `ai_judge` factor so it renders alongside the deterministic factors.
 *
 * Never-block, identical contract to lib/ai/trust-validate: a missing API key,
 * a missing match, a Claude error, or the 8s timeout all return `{ ok: false }`
 * and leave the deterministic score untouched. The judge only ever *adds*
 * explanation; it never gates an accept/dismiss.
 * ========================================================================= */

const MODEL = AI_MODELS.chat;
const AI_TIMEOUT_MS = 8_000;

export interface MatchJudgement {
  ok: boolean;
  confidence?: number;
  verdict?: string;
  reason?: string;
}

interface RationaleFactor {
  factor?: string;
  weight?: number;
  detail?: string;
  routed_specialist?: string;
  [key: string]: unknown;
}

const SPECIALIST_TITLE: Record<string, string> = {
  eleanor: 'Head of Investor Relations',
  marcus: 'Head of Deal Origination',
  priya: 'Director of Capital Markets',
  adrian: 'General Counsel & Compliance',
  noah: 'Head of Digital Presence',
  dalia: 'Head of Data Operations'
};

function asArray(value: unknown): RationaleFactor[] {
  return Array.isArray(value) ? (value as RationaleFactor[]) : [];
}

function routedSpecialist(factors: RationaleFactor[]): string {
  for (const f of factors) {
    if (typeof f.routed_specialist === 'string' && f.routed_specialist) return f.routed_specialist;
  }
  return 'dalia';
}

/** Parse `CONFIDENCE: 73` (tolerant) from Claude's reply; null when absent. */
function parseConfidence(text: string): number | null {
  const m = text.match(/confidence[:\s]+(\d{1,3})/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/**
 * Ask Claude for a second opinion on a single match and persist it. Caller
 * (the server action) is responsible for authorizing the user against the
 * match's org before invoking this.
 */
export async function judgeMatch(matchId: string): Promise<MatchJudgement> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'no_api_key' };
  if (!matchId) return { ok: false, reason: 'no_match' };

  const admin = createAdminClient();

  const { data: match } = await admin
    .from('matches')
    .select('id, kind, subject_id, score, rationale')
    .eq('id', matchId)
    .maybeSingle();

  if (!match) return { ok: false, reason: 'not_found' };

  const factors = asArray(match.rationale);
  const specialist = routedSpecialist(factors);

  // Pull the underlying signal for context when this is a signal match.
  let signalContext = '';
  if (match.kind === 'signal') {
    const { data: signal } = await admin
      .from('market_signals')
      .select('source, kind, severity, normalized')
      .eq('id', match.subject_id)
      .maybeSingle();
    if (signal) {
      const normalized =
        signal.normalized && typeof signal.normalized === 'object'
          ? (signal.normalized as Record<string, unknown>)
          : {};
      const title =
        normalized.issuer_name ??
        normalized.entity_name ??
        normalized.company_name ??
        normalized.fund_name ??
        signal.kind;
      signalContext = `Signal: ${String(title)} · source ${signal.source} · kind ${signal.kind} · severity ${signal.severity}.`;
    }
  }

  const factorLines = factors
    .filter((f) => f.factor && f.factor !== 'match_reason')
    .map((f) => `- ${f.factor} (+${f.weight ?? 0}): ${f.detail ?? ''}`)
    .join('\n');

  const title = SPECIALIST_TITLE[specialist] ?? 'specialist';
  const prompt = `${signalContext}

Deterministic score: ${match.score}/100. Factor breakdown:
${factorLines || '- (no factors)'}

You are this desk's ${title}. Give the operator a fast second opinion: should they act on this match now, watch it, or pass? Start your reply with a line "CONFIDENCE: NN" (0-100, your calibrated confidence that acting on this is worth their time), then one or two plain sentences of judgment. Sentence case, operator-grade, no preamble.`;

  let text = '';
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 300,
        system:
          'You are a member of the 15-specialist FundExecs OS executive team giving a crisp, calibrated second opinion on a scored market-signal match. Be decisive and brief. Never invent facts beyond the supplied context.',
        messages: [{ role: 'user', content: prompt }]
      },
      { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }
    );
    text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch {
    return { ok: false, reason: 'judge_failed' };
  }

  if (!text) return { ok: false, reason: 'empty_reply' };

  const confidence = parseConfidence(text) ?? match.score;
  const verdict = text.replace(/^\s*confidence[:\s]+\d{1,3}\s*/i, '').trim();

  // Replace any prior ai_judge factor, then append the fresh verdict.
  const nextRationale: RationaleFactor[] = [
    ...factors.filter((f) => f.factor !== 'ai_judge'),
    {
      factor: 'ai_judge',
      weight: 0,
      confidence,
      detail: verdict,
      routed_specialist: specialist,
      judged_at: new Date().toISOString()
    }
  ];

  const { error } = await admin
    .from('matches')
    .update({ rationale: nextRationale as unknown as never })
    .eq('id', matchId);

  if (error) return { ok: false, reason: error.message };
  return { ok: true, confidence, verdict };
}
