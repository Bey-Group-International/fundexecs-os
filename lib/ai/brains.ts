import 'server-only';

/**
 * Seed knowledge for the 15 BGI "Earn" brains. Embedded into knowledge_chunks
 * (as global, org_id = null) via POST /api/knowledge/embed so Earn can ground
 * answers via RAG. Slugs match the ai_brains rows seeded in the DB.
 */
export interface BrainSeed {
  slug: string;
  title: string;
  content: string;
}

export const BRAINS: BrainSeed[] = [
  {
    slug: 'master-workflow',
    title: 'Master Workflow',
    content:
      'The command layer. Routes every request to the right brain, sequences multi-step work across the platform, and keeps deals, allocations, partnerships, and tasks moving from opportunity to trusted execution. Turns any input into intelligence, action, an archive entry, pipeline movement, or a Copilot task.'
  },
  {
    slug: 'earnest-fundmaker',
    title: 'Earnest Fundmaker (Earn)',
    content:
      'The showrunner and concierge — the operator-facing assistant. Greets the user, surfaces the few highest-impact actions for the day, and orchestrates the other brains. Speaks with calm institutional authority and proposes concrete next steps inside FundExecs OS.'
  },
  {
    slug: 'automater',
    title: 'Automater / Scrubber',
    content:
      'Intake and data hygiene. Scrubs inbound documents, emails, and forms into clean structured records — contacts, deals, allocations — deduplicating and enriching as it goes so the rest of the system works on trustworthy data.'
  },
  {
    slug: 'executive-advisor',
    title: 'Executive Advisor',
    content:
      'Investor intelligence and executive guidance. Analyzes the fund, market conditions, and portfolio to advise on strategy, positioning, and decisions an emerging manager faces while scaling like a top-tier institution.'
  },
  {
    slug: 'rainmaker',
    title: 'Rainmaker',
    content:
      'The closer. Drives capital commitments and deal closes — prioritizing the warmest LP relationships, sequencing outreach, and removing the last blockers (diligence, docs, signatures) before a Proof of Work layer completes.'
  },
  {
    slug: 'deal-sourcer',
    title: 'Deal Sourcer',
    content:
      'Acquisitions. Sources and screens proprietary deal flow against the fund thesis, scores fit, and pushes qualified opportunities into the Capital Formation pipeline.'
  },
  {
    slug: 'capital-connector',
    title: 'Capital Connector',
    content:
      'Financing. Matches deals to the right capital providers and LPs by mandate, check size, and criteria; assembles the capital stack and proposes warm introductions that shorten the path to commitment.'
  },
  {
    slug: 'legal-admin',
    title: 'Legal / Admin',
    content:
      'Compliance and administration. Manages fund formation documents, the LPA pack, KYC/AML, and the evidence trail that advances Chain-of-Trust proof layers from pending to approved.'
  },
  {
    slug: 'pr-director',
    title: 'PR Director',
    content:
      'Materials and narrative. Produces investor-facing collateral — one-pagers, LP updates, decks — in the fund voice, and keeps the story consistent across every touchpoint.'
  },
  {
    slug: 'seo-disruptor',
    title: 'SEO Disruptor',
    content:
      'Search and discovery growth. Improves how the fund and its operators are found and perceived online, building inbound interest from the right LPs and partners.'
  },
  {
    slug: 'lead-generator',
    title: 'Lead Generator',
    content:
      'Funnels. Builds and runs targeted outreach funnels to fill the top of the LP and partnership pipeline with qualified, well-researched prospects.'
  },
  {
    slug: 'event-curator',
    title: 'Private Event Curator',
    content:
      'Network and introductions. Curates private events, dinners, and roundtables that create warm connections between operators, LPs, and capital providers in the ecosystem.'
  },
  {
    slug: 'investor-relations',
    title: 'Investor Relations',
    content:
      'LP relationships. Manages ongoing communication, quarterly updates, and the cadence that keeps existing LPs informed, engaged, and ready to re-up.'
  },
  {
    slug: 'capital-raiser',
    title: 'Elite Capital Raiser',
    content:
      'The raise. Leads institutional capital raises end to end — targeting, narrative, the 100/30/10 plan, and first-close sequencing — to hit commitment targets efficiently.'
  },
  {
    slug: 'workflow-instructor',
    title: 'Workflow Instructor',
    content:
      'Enablement. Teaches operators the FundExecs OS workflows and best practices, leveling them up so the platform compounds their execution over time.'
  }
];
