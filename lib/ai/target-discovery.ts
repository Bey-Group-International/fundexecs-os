import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { TEAM_ROSTER } from '@/lib/team/roster';

/* ============================================================================
 * lib/ai/target-discovery.ts — LLM-assisted acquisition/investment target
 * discovery for the Target Scout (SOURCE verb). Turns a fund thesis or
 * mandate ("lower-middle-market B2B SaaS at <5x ARR", "industrial services
 * carve-outs in the Southeast") into scored, structured target candidates.
 * Env-gated: with no ANTHROPIC_API_KEY → configured:false and the UI falls
 * back to manual search. LLM-only this increment — no external data API.
 * AI-suggested — operator must verify before outreach.
 * ========================================================================= */

const MODEL = process.env.TARGET_DISCOVERY_MODEL || process.env.EARN_MODEL || 'claude-sonnet-4-6';

/** Canonical roster slugs for target-side routing (sourcing + capital desk). */
const SPECIALIST_SLUGS = TEAM_ROSTER.filter((m) => !m.chief).map((m) => m.slug);

export interface ScoutedTarget {
  companyName: string;
  /** Industry / vertical, e.g. "B2B SaaS", "Industrial Services". */
  sector: string;
  /** Deal archetype, e.g. "Buyout", "Growth Equity", "Venture", "Co-invest". */
  dealType: string;
  /** Human-readable estimated enterprise value range, e.g. "$10M–$30M". */
  estValuation: string;
  /** How well this target fits the stated thesis (0–100, higher is better). */
  thesisFit: number;
  /** One-sentence explanation of why this target fits the mandate. */
  fitRationale: string;
  /** Two-sentence suggested first-touch framing the operator can adapt. */
  suggestedOutreach: string;
  /** Canonical roster slug of the specialist who should own this target. */
  routedSpecialist: string;
}

export interface TargetDiscoverResult {
  configured: boolean;
  candidates: ScoutedTarget[];
}

const TOOL_NAME = 'return_targets';

const SYSTEM_PROMPT = `You are the Head of Deal Origination and Capital Connector for FundExecs OS, an AI-native private-market command center. A fund operator wants to identify acquisition or investment targets that match their mandate.

Given a plain-English thesis, propose realistic target companies: private businesses, founder-owned companies, corporate carve-outs, growth-stage ventures, or sector-specific opportunities that plausibly fit the mandate.

Rules:
- Propose archetypal targets that credibly match the sector and deal type described. You may name well-known private companies if they plausibly match, but prefer clearly archetypal descriptions when uncertain. Never fabricate financials, ownership details, named executives, or revenue figures.
- estValuation: a rough human-readable EV range, e.g. "$5M–$20M" or "$50M–$150M". Calibrate to the deal type and sector.
- thesisFit: an integer 0–100 reflecting how well the target archetype matches the stated thesis. Be honest — not everything should score 90+.
- fitRationale: one tight, operator-grade sentence.
- suggestedOutreach: 2–3 sentences, professional, sentence case, no emoji. Reference the fit angle, not invented facts. Something the operator could adapt as a first touch.
- Assign routedSpecialist to the single most appropriate specialist slug from the allowed list.
- Return 4–6 candidates, best-fit first.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Return the structured list of target candidates.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            companyName: { type: 'string' },
            sector: { type: 'string' },
            dealType: { type: 'string' },
            estValuation: { type: 'string' },
            thesisFit: { type: 'number', minimum: 0, maximum: 100 },
            fitRationale: { type: 'string' },
            suggestedOutreach: { type: 'string' },
            routedSpecialist: {
              type: 'string',
              enum: SPECIALIST_SLUGS
            }
          },
          required: [
            'companyName',
            'sector',
            'dealType',
            'estValuation',
            'thesisFit',
            'fitRationale',
            'suggestedOutreach',
            'routedSpecialist'
          ]
        }
      }
    },
    required: ['candidates']
  }
};

/** Clamp thesisFit to [0, 100] and coerce to integer. */
function clampFit(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(0, Math.min(100, v));
}

/** Clamp routedSpecialist to a known roster slug; fallback to deal-sourcer. */
function clampSpecialist(s: unknown): string {
  const v = typeof s === 'string' ? s.trim() : '';
  return SPECIALIST_SLUGS.includes(v) ? v : 'deal-sourcer';
}

/** Sanitize raw LLM output into typed, validated `ScoutedTarget[]`. */
function sanitize(raw: unknown): ScoutedTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: ScoutedTarget[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const companyName = typeof r.companyName === 'string' ? r.companyName.trim() : '';
    if (!companyName) continue;
    out.push({
      companyName,
      sector: typeof r.sector === 'string' ? r.sector.trim() : '',
      dealType: typeof r.dealType === 'string' ? r.dealType.trim() : '',
      estValuation: typeof r.estValuation === 'string' ? r.estValuation.trim() : '',
      thesisFit: clampFit(r.thesisFit),
      fitRationale: typeof r.fitRationale === 'string' ? r.fitRationale.trim() : '',
      suggestedOutreach: typeof r.suggestedOutreach === 'string' ? r.suggestedOutreach.trim() : '',
      routedSpecialist: clampSpecialist(r.routedSpecialist)
    });
  }
  return out.slice(0, 8);
}

/**
 * Propose scored acquisition/investment targets for a fund thesis.
 *
 * Never throws — returns `{ configured: false, candidates: [] }` when the
 * API key is absent or an error occurs, so the UI can degrade gracefully.
 */
export async function discoverTargets({
  query,
  context
}: {
  query: string;
  context?: string;
}): Promise<TargetDiscoverResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { configured: false, candidates: [] };

  const trimmed = query.trim().slice(0, 600);
  if (!trimmed) return { configured: true, candidates: [] };

  const ctxLine = context ? `\nFund context: ${context.slice(0, 300)}` : '';

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: `Fund mandate / thesis: ${trimmed}${ctxLine}` }]
    });

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return { configured: true, candidates: [] };
    const input = block.input as { candidates?: unknown };
    return { configured: true, candidates: sanitize(input.candidates) };
  } catch {
    // Never propagate — callers depend on the graceful fallback.
    return { configured: true, candidates: [] };
  }
}
