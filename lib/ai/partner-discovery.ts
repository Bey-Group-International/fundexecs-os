import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/* ============================================================================
 * lib/ai/partner-discovery.ts — LLM-assisted provider discovery for the
 * Partner Marketplace. Turns a natural-language need ("fund admin for an
 * emerging manager in NY", "family offices that back first-time funds") into
 * structured provider candidates the operator can vet and bring into the
 * system.
 *
 * Env-gated: with no ANTHROPIC_API_KEY the feature reports `configured: false`
 * and the UI falls back to manual add. Candidates are AI-suggested and clearly
 * labelled "verify" in the UI — they are leads to confirm, not facts.
 * ========================================================================= */

const MODEL = process.env.PARTNER_DISCOVERY_MODEL || process.env.EARN_MODEL || 'claude-sonnet-4-6';

export type ProviderKind = 'service' | 'capital';

/** A single AI-suggested provider candidate. */
export interface DiscoveredProvider {
  kind: ProviderKind;
  name: string;
  /** Service: the category (e.g. "fund_admin", "legal"). */
  category?: string;
  /** Capital: the capital types (e.g. ["family_office", "fund_of_funds"]). */
  capitalTypes?: string[];
  /** Capital: typical check size range in USD. */
  checkSizeMin?: number | null;
  checkSizeMax?: number | null;
  /** Service: a few capability tags. */
  capabilities?: string[];
  /** One-line description of the provider. */
  description: string;
  /** Why this provider fits the stated need. */
  fitRationale: string;
  /** Which FundExecs specialist should own bringing them in. */
  suggestedSpecialist: string;
}

export interface DiscoverResult {
  configured: boolean;
  candidates: DiscoveredProvider[];
}

/** Specialists the model may assign work to (kept in sync with the roster). */
const SPECIALISTS = [
  'Rainmaker',
  'Deal Sourcer',
  'Capital Connector',
  'Legal / Admin',
  'Investor Relations',
  'Elite Capital Raiser',
  'Executive Advisor',
  'PR Director',
  'Private Event Curator',
  'Lead Generator'
] as const;

const TOOL_NAME = 'return_providers';

const SYSTEM_PROMPT = `You are the Deal Sourcer and Capital Connector for FundExecs OS, an AI-native private-market command center. The operator is searching for partners to bring into their firm's directory.

Given a natural-language need, propose realistic, well-known provider candidates that match. Two kinds:
- "service": service providers (fund administration, legal, compliance, audit/tax, banking, technology, placement, IR, marketing, etc.).
- "capital": capital providers (LPs, family offices, fund-of-funds, endowments, pensions, sovereign wealth, RIAs, syndicates, etc.).

Rules:
- Prefer real, recognizable firms that plausibly match the need; if you are unsure a specific firm exists, describe a clearly-archetypal candidate instead. Never fabricate contact details, AUM, or specific check sizes you cannot reasonably estimate.
- Estimated check sizes are rough ranges in USD integers (e.g. 250000, 5000000), only for capital providers.
- Keep descriptions and rationales to one tight sentence each, operator-grade and specific.
- Assign each candidate to the single most appropriate specialist from the allowed list.
- Return 4-6 candidates, ordered best-fit first. Respect the requested kind filter.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Return the structured list of provider candidates.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['service', 'capital'] },
            name: { type: 'string' },
            category: { type: 'string', description: 'snake_case category for service providers' },
            capitalTypes: {
              type: 'array',
              items: { type: 'string' },
              description: 'snake_case capital types for capital providers'
            },
            checkSizeMin: { type: 'number' },
            checkSizeMax: { type: 'number' },
            capabilities: { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            fitRationale: { type: 'string' },
            suggestedSpecialist: { type: 'string', enum: SPECIALISTS as unknown as string[] }
          },
          required: ['kind', 'name', 'description', 'fitRationale', 'suggestedSpecialist']
        }
      }
    },
    required: ['candidates']
  }
};

function clampSpecialist(s: unknown): string {
  const v = typeof s === 'string' ? s.trim() : '';
  return (SPECIALISTS as readonly string[]).includes(v) ? v : 'Deal Sourcer';
}

function sanitize(raw: unknown, kindFilter: ProviderKind | 'both'): DiscoveredProvider[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscoveredProvider[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const kind: ProviderKind = r.kind === 'capital' ? 'capital' : 'service';
    if (kindFilter !== 'both' && kind !== kindFilter) continue;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    out.push({
      kind,
      name,
      category: typeof r.category === 'string' ? r.category.trim() : undefined,
      capitalTypes: Array.isArray(r.capitalTypes)
        ? (r.capitalTypes as unknown[]).filter((t): t is string => typeof t === 'string')
        : undefined,
      checkSizeMin: typeof r.checkSizeMin === 'number' ? Math.round(r.checkSizeMin) : null,
      checkSizeMax: typeof r.checkSizeMax === 'number' ? Math.round(r.checkSizeMax) : null,
      capabilities: Array.isArray(r.capabilities)
        ? (r.capabilities as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .slice(0, 6)
        : undefined,
      description: typeof r.description === 'string' ? r.description.trim() : '',
      fitRationale: typeof r.fitRationale === 'string' ? r.fitRationale.trim() : '',
      suggestedSpecialist: clampSpecialist(r.suggestedSpecialist)
    });
  }
  return out.slice(0, 8);
}

export async function discoverProviders({
  query,
  kind = 'both',
  orgContext
}: {
  query: string;
  kind?: ProviderKind | 'both';
  /** Optional one-line org context (fund name / thesis) to sharpen results. */
  orgContext?: string;
}): Promise<DiscoverResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { configured: false, candidates: [] };

  const trimmed = query.trim().slice(0, 600);
  if (!trimmed) return { configured: true, candidates: [] };

  const kindLine =
    kind === 'both'
      ? 'Include both service and capital providers as relevant.'
      : `Only return ${kind} providers.`;
  const ctxLine = orgContext ? `\nOperator context: ${orgContext.slice(0, 300)}` : '';

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: `Need: ${trimmed}\n${kindLine}${ctxLine}` }]
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return { configured: true, candidates: [] };
  const input = block.input as { candidates?: unknown };
  return { configured: true, candidates: sanitize(input.candidates, kind) };
}
