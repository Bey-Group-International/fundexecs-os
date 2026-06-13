/* ============================================================================
 * lib/earn/routing — the specialist router (PURE, icon-free, testable).
 *
 * Earn is the COO: every ask routes to the desk that owns it, and that desk's
 * prior outputs on the mandate load as context for the answer (see
 * buildSpecialistMemory in lib/ai/awareness.ts). This module is the
 * classification half — a deterministic, keyword-based map from an operator's
 * ask to the specialist slug, plus the human label for the "Routing to {name}…"
 * moment. No model call, no React/icon import, so it stays unit-testable.
 *
 * Rules are evaluated in order, first match wins. The order encodes priority:
 * the raise + IR + chief-of-staff desks (where operators spend the most
 * attention) sit ahead of the broader desks so a mixed ask lands on the right
 * owner. Anything unmatched stays with Earn, who synthesises across the team.
 *
 * Slugs are the canonical `ai_brains.slug` values — see lib/ai/brains.ts. The
 * regression suite locks every slug here to a real brain.
 * ========================================================================= */

export const EARN_COO_SLUG = 'earnest-fundmaker';

interface RouteRule {
  slug: string;
  test: RegExp;
}

const ROUTE_RULES: RouteRule[] = [
  // Eleanor — Investor Relations: LP trust, updates, the data room cadence.
  {
    slug: 'investor-relations',
    test: /\b(lp letter|investor letter|investor update|lp update|quarterly update|investor relations|data ?room|keep .{0,20}warm|follow ?up with|reporting)\b/i
  },
  // Sloane — Capital Formation: the raise itself, targets, allocation, close.
  {
    slug: 'capital-raiser',
    test: /\b(raise|fundrais\w*|capital formation|allocation|commitments?|target list|who .{0,30}raise|final close|first close|close the round|anchor)\b/i
  },
  // Sterling — Chief of Staff: workflows, sequencing, close plans, next steps.
  {
    slug: 'master-workflow',
    test: /\b(workflow|next steps?|sequence|checklist|close plan|operating plan|meeting notes?|to-?do|action items?)\b/i
  },
  // Priya — Capital Markets: co-invest, lenders, structure, syndication.
  {
    slug: 'capital-connector',
    test: /\b(co-?invest\w*|lender|debt|leverage|structur\w*|syndicat\w*|capital markets|counterpart\w*)\b/i
  },
  // Adrian — Counsel & Compliance: formation, legal, risk, red flags.
  {
    slug: 'legal-admin',
    test: /\b(complian\w*|legal|counsel|formation|regulat\w*|terms?|red flags?|risk|audit|kyc|disclosure)\b/i
  },
  // Marcus — Deal Origination: sourcing, pipeline, on-thesis targets.
  {
    slug: 'deal-sourcer',
    test: /\b(source|sourc\w*|deal flow|pipeline|on-?thesis|origination|find .{0,20}deals?|scout)\b/i
  },
  // Theodore — Chief Strategy Advisor: thesis, strategy, positioning.
  {
    slug: 'executive-advisor',
    test: /\b(thesis|strateg\w*|positioning|pressure-?test|market view|outlook)\b/i
  },
  // Dalia — Data Operations: the record, reconciliation, clean data.
  {
    slug: 'automater',
    test: /\b(data|record|reconcil\w*|clean ?up|import|dedup\w*|enrich)\b/i
  },
  // Vivian — Demand Generation: top-of-funnel demand for portfolio companies.
  {
    slug: 'rainmaker',
    test: /\b(demand|campaign|top of funnel|awareness|inbound)\b/i
  },
  // Camille — Top-of-Funnel: qualified leads, prospecting, intent.
  {
    slug: 'lead-generator',
    test: /\b(leads?|prospect\w*|intent|qualif\w*)\b/i
  },
  // Sienna — Communications: narrative, brand, deck story, press.
  {
    slug: 'pr-director',
    test: /\b(narrative|brand|press|messaging|deck story|comms?|public relations)\b/i
  },
  // Noah — Digital Presence: site, SEO, digital footprint.
  {
    slug: 'seo-disruptor',
    test: /\b(seo|website|digital|search|web presence|footprint)\b/i
  },
  // Jasper — Private Events: dinners, convenings, rooms.
  {
    slug: 'event-curator',
    test: /\b(events?|dinner|convening|roundtable|summit|gathering)\b/i
  },
  // Felix — Enablement: teaching, walkthroughs, onboarding.
  {
    slug: 'workflow-instructor',
    test: /\b(how do i|teach|walk ?through|onboard\w*|tutorial|get started|learn)\b/i
  }
];

/** Human first-name labels for the "Routing to {name}…" moment. */
export const SPECIALIST_LABELS: Record<string, string> = {
  'earnest-fundmaker': 'Earn',
  'master-workflow': 'Sterling',
  automater: 'Dalia',
  'executive-advisor': 'Theodore',
  rainmaker: 'Vivian',
  'deal-sourcer': 'Marcus',
  'capital-connector': 'Priya',
  'legal-admin': 'Adrian',
  'pr-director': 'Sienna',
  'seo-disruptor': 'Noah',
  'lead-generator': 'Camille',
  'event-curator': 'Jasper',
  'investor-relations': 'Eleanor',
  'capital-raiser': 'Sloane',
  'workflow-instructor': 'Felix'
};

/**
 * Route an ask to the specialist that owns it. Deterministic, first-match-wins;
 * falls back to Earn (the COO) when nothing matches, so the answer is always
 * attributed to a real desk.
 */
export function routeAsk(text: string | null | undefined): string {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return EARN_COO_SLUG;
  for (const rule of ROUTE_RULES) {
    if (rule.test.test(t)) return rule.slug;
  }
  return EARN_COO_SLUG;
}

/** The human label for a routed specialist, defaulting to Earn. */
export function specialistLabel(slug: string): string {
  return SPECIALIST_LABELS[slug] ?? 'Earn';
}
