import 'server-only';
import { getMemberOrCOO } from '@/lib/team/roster';

/**
 * Earn Diligence Intelligence Layer — orchestration config.
 *
 * The seven agents are framed as Earn's executive team running an investment
 * committee. Six analytical agents work in parallel; the seventh (Synthesis,
 * Earn herself) weighs their findings into the final judgment.
 *
 * Each analytical agent maps to an existing executive persona from
 * `lib/team/roster.ts` (slugs MUST stay stable — they back the Voyage
 * embeddings) so the diligence voice matches the rest of the desk.
 */

/** The six analytical agents (`diligence_findings.agent` allowed values). */
export const ANALYST_AGENTS = [
  'market_size',
  'competitive',
  'customer_demand',
  'unit_economics',
  'stress_test',
  'red_flags'
] as const;

export type AnalystAgent = (typeof ANALYST_AGENTS)[number];

/** The synthesis agent — the final, paid judgment. */
export const SYNTHESIS_AGENT = 'synthesis' as const;

export type DiligenceAgent = AnalystAgent | typeof SYNTHESIS_AGENT;

/**
 * Model tiering — a single config object so models are trivially swappable.
 * The six analysts default to Haiku (fast, cheap, run in parallel); Synthesis
 * defaults to Opus (the judgment that justifies the work). Both are
 * env-overridable. Model IDs are the latest as of the Claude API skill.
 */
export const DILIGENCE_MODELS = {
  analyst: process.env.DILIGENCE_ANALYST_MODEL || 'claude-haiku-4-5-20251001',
  synthesis: process.env.DILIGENCE_SYNTHESIS_MODEL || 'claude-opus-4-8'
} as const;

/** Number of cited chunks to retrieve per analytical agent. */
export const RETRIEVAL_MATCH_COUNT = 12;

interface AnalystSpec {
  /** Roster slug whose persona/voice this agent borrows. */
  slug: string;
  /** Human label for the lane (used in prompts + logs). */
  label: string;
  /** What this agent is responsible for assessing. */
  mandate: string;
  /** The retrieval query used to pull cited context for this agent. */
  retrievalQuery: string;
}

/**
 * Per-agent specification. The persona name/position is resolved from the
 * roster at prompt-build time so display fields stay in one place.
 */
export const ANALYST_SPECS: Record<AnalystAgent, AnalystSpec> = {
  market_size: {
    slug: 'executive-advisor', // Theodore — Chief Strategy Advisor
    label: 'Market Size',
    mandate:
      'Assess total addressable market (TAM/SAM/SOM), market growth rate, secular tailwinds, and timing. Judge whether the market is large and growing enough to support an institutional return.',
    retrievalQuery:
      'total addressable market TAM SAM SOM market size growth rate industry tailwinds market opportunity'
  },
  competitive: {
    slug: 'deal-sourcer', // Marcus — Head of Deal Origination
    label: 'Competitive Intelligence',
    mandate:
      'Map incumbents and challengers, evaluate moats and defensibility, positioning, and competitive threats. Judge whether this company can win and hold share.',
    retrievalQuery:
      'competitors competitive landscape incumbents moat defensibility differentiation market positioning barriers to entry'
  },
  customer_demand: {
    slug: 'rainmaker', // Vivian — MD, Demand Generation
    label: 'Customer & Demand',
    mandate:
      'Evaluate demand signals, customer retention and churn, revenue concentration, sales pipeline, and quality of demand. Judge whether real, durable demand exists.',
    retrievalQuery:
      'customers demand retention churn revenue concentration pipeline contracts logos net revenue retention cohorts'
  },
  unit_economics: {
    slug: 'automater', // Dalia — Head of Data Operations
    label: 'Pricing & Unit Economics',
    mandate:
      'Analyze pricing power, gross and contribution margins, CAC, LTV, payback period, and the path to profitability. Judge whether the unit economics work at scale.',
    retrievalQuery:
      'pricing unit economics gross margin contribution margin CAC LTV payback period burn cash flow profitability'
  },
  stress_test: {
    slug: 'master-workflow', // Sterling — Chief of Staff
    label: 'Stress Test',
    mandate:
      'Run downside scenarios, sensitivities, and break-evens. Probe key assumptions and dependencies. Judge how resilient the business is to adverse conditions.',
    retrievalQuery:
      'assumptions downside scenario sensitivity break-even runway dependencies risks projections forecast worst case'
  },
  red_flags: {
    slug: 'legal-admin', // Adrian — General Counsel & Compliance
    label: 'Red Flags',
    mandate:
      'Surface inconsistencies, gaps, and governance, legal, regulatory, or financial risks. Judge the integrity of the materials and flag anything that should give an LP pause.',
    retrievalQuery:
      'legal regulatory compliance governance litigation related party inconsistencies missing disclosures financial irregularities risk factors'
  }
};

/** Synthesis (Earn) borrows the COO persona. */
export const SYNTHESIS_SLUG = 'earnest-fundmaker' as const;

/** Resolve the display persona (name + position) for an agent's slug. */
export function personaFor(slug: string): { name: string; position: string } {
  const member = getMemberOrCOO(slug);
  return { name: member.name, position: member.position };
}
