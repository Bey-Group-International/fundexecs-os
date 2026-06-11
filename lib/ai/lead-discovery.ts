import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { sanitizeLeadCandidates, type LeadCandidate } from '@/lib/leads/engine';

/**
 * lib/ai/lead-discovery.ts — Vivian & Camille's customer-lead generator.
 *
 * Turns a portfolio company description into scored, structured customer-lead
 * candidates for its Lead Engine. Modeled on `target-discovery.ts`: one
 * forced tool call, sanitized output, graceful degradation — never throws,
 * and reports `configured: false` when no API key is present.
 */

const MODEL = process.env.LEAD_DISCOVERY_MODEL || process.env.EARN_MODEL || 'claude-sonnet-4-6';

const TOOL_NAME = 'propose_leads';

const SYSTEM_PROMPT = `You are Vivian (MD, Demand Generation) and Camille (Head of Top-of-Funnel) at a private-equity portfolio company's growth desk.
Given a portfolio company and its segment, propose realistic customer-lead archetypes the demand engine should pursue: the kind of company, the buying signal to look for, estimated annual contract value, and a 0-100 intent score for how warm that archetype typically is.
Ground every candidate in the portfolio company's actual market. Be concrete and conservative — these seed a real pipeline.
Return 4-6 candidates, highest intent first.`;

const TOOL = {
  name: TOOL_NAME,
  description: 'Return the structured list of customer-lead candidates.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidates: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const, description: 'Lead company name or archetype.' },
            segment: { type: 'string' as const, description: 'Market segment / vertical.' },
            intent: {
              type: 'number' as const,
              description: '0-100 buying-intent score for this archetype.'
            },
            estValue: {
              type: 'number' as const,
              description: 'Estimated annual contract value in dollars.'
            },
            signal: {
              type: 'string' as const,
              description: 'The buying signal that qualifies this lead.'
            }
          },
          required: ['name', 'segment', 'intent', 'signal']
        }
      }
    },
    required: ['candidates']
  }
};

export interface LeadDiscoverResult {
  configured: boolean;
  candidates: LeadCandidate[];
}

/**
 * Propose customer leads for a closed acquisition. Never throws — returns
 * `{ configured: false, candidates: [] }` when the API key is absent, and an
 * empty candidate list on any model error.
 */
export async function discoverLeads({
  portco,
  context
}: {
  portco: string;
  context?: string;
}): Promise<LeadDiscoverResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { configured: false, candidates: [] };

  const trimmed = portco.trim().slice(0, 300);
  if (!trimmed) return { configured: true, candidates: [] };

  const ctxLine = context ? `\nContext: ${context.slice(0, 300)}` : '';

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: `Portfolio company: ${trimmed}${ctxLine}` }]
    });

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return { configured: true, candidates: [] };
    const input = block.input as { candidates?: unknown };
    return { configured: true, candidates: sanitizeLeadCandidates(input.candidates) };
  } catch {
    // Never propagate — callers depend on the graceful fallback.
    return { configured: true, candidates: [] };
  }
}
