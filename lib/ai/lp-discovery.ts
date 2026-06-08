import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/* ============================================================================
 * lib/ai/lp-discovery.ts — LLM-assisted LP discovery for the LP Pipeline.
 * Turns a plain-English raise thesis ("family offices backing first-time
 * sub-$50M funds", "endowments active in lower-middle-market PE") into
 * structured LP candidates — enriched with capital type, typical check size, a
 * thesis-fit rationale, the specialist who should own them, and a tailored
 * first-touch note. Env-gated: with no ANTHROPIC_API_KEY → configured:false and
 * the UI falls back to manual add. AI-suggested — verify before outreach.
 * ========================================================================= */

const MODEL = process.env.LP_DISCOVERY_MODEL || process.env.EARN_MODEL || 'claude-sonnet-4-6';

export interface DiscoveredLp {
  name: string;
  /** Capital archetypes, e.g. ["family_office", "fund_of_funds"]. */
  capitalTypes: string[];
  /** Typical commitment range in USD. */
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  /** One-line description of the LP. */
  description: string;
  /** Why this LP fits the stated raise thesis. */
  fitRationale: string;
  /** FundExecs specialist who should own the relationship. */
  suggestedSpecialist: string;
  /** A short, tailored first-touch note the operator can send/adapt. */
  firstTouchNote: string;
}

export interface LpDiscoverResult {
  configured: boolean;
  candidates: DiscoveredLp[];
}

/** Capital-side specialists the model may assign LPs to. */
const SPECIALISTS = [
  'Capital Connector',
  'Investor Relations',
  'Elite Capital Raiser',
  'Rainmaker',
  'Executive Advisor',
  'Private Event Curator'
] as const;

const TOOL_NAME = 'return_lps';

const SYSTEM_PROMPT = `You are the Capital Connector and Elite Capital Raiser for FundExecs OS, an AI-native private-market command center. A fund operator is building their LP pipeline and wants prospective limited partners that match their raise.

Given a plain-English thesis, propose realistic LP candidates: family offices, fund-of-funds, endowments, foundations, pensions, sovereign wealth, insurance, RIAs/wealth platforms, and active angel/LP syndicates.

Rules:
- Prefer real, recognizable institutions that plausibly match; if unsure a specific name exists, describe a clearly-archetypal LP instead. Never fabricate contact details, AUM, named individuals, or commitments.
- Estimated check sizes are rough commitment ranges in USD integers (e.g. 250000, 5000000).
- description and fitRationale: one tight, operator-grade sentence each.
- firstTouchNote: 2-3 sentences, warm but institutional, sentence case, no emoji — a first outreach the operator could adapt. Reference the fit, not invented facts.
- Assign each LP to the single most appropriate specialist from the allowed list.
- Return 4-6 candidates, best-fit first.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Return the structured list of LP candidates.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            capitalTypes: {
              type: 'array',
              items: { type: 'string' },
              description: 'snake_case capital types'
            },
            checkSizeMin: { type: 'number' },
            checkSizeMax: { type: 'number' },
            description: { type: 'string' },
            fitRationale: { type: 'string' },
            suggestedSpecialist: { type: 'string', enum: SPECIALISTS as unknown as string[] },
            firstTouchNote: { type: 'string' }
          },
          required: ['name', 'description', 'fitRationale', 'suggestedSpecialist', 'firstTouchNote']
        }
      }
    },
    required: ['candidates']
  }
};

function clampSpecialist(s: unknown): string {
  const v = typeof s === 'string' ? s.trim() : '';
  return (SPECIALISTS as readonly string[]).includes(v) ? v : 'Capital Connector';
}

function sanitize(raw: unknown): DiscoveredLp[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscoveredLp[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    out.push({
      name,
      capitalTypes: Array.isArray(r.capitalTypes)
        ? (r.capitalTypes as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .slice(0, 6)
        : [],
      checkSizeMin: typeof r.checkSizeMin === 'number' ? Math.round(r.checkSizeMin) : null,
      checkSizeMax: typeof r.checkSizeMax === 'number' ? Math.round(r.checkSizeMax) : null,
      description: typeof r.description === 'string' ? r.description.trim() : '',
      fitRationale: typeof r.fitRationale === 'string' ? r.fitRationale.trim() : '',
      suggestedSpecialist: clampSpecialist(r.suggestedSpecialist),
      firstTouchNote: typeof r.firstTouchNote === 'string' ? r.firstTouchNote.trim() : ''
    });
  }
  return out.slice(0, 8);
}

export async function discoverLps({
  query,
  orgContext
}: {
  query: string;
  orgContext?: string;
}): Promise<LpDiscoverResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { configured: false, candidates: [] };

  const trimmed = query.trim().slice(0, 600);
  if (!trimmed) return { configured: true, candidates: [] };

  const ctxLine = orgContext ? `\nFund context: ${orgContext.slice(0, 300)}` : '';

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: `Raise thesis: ${trimmed}${ctxLine}` }]
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return { configured: true, candidates: [] };
  const input = block.input as { candidates?: unknown };
  return { configured: true, candidates: sanitize(input.candidates) };
}
