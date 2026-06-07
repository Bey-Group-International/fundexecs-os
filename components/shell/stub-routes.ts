import {
  Inbox,
  Layers,
  MessagesSquare,
  Mail,
  FilePlus,
  Handshake,
  History,
  type LucideIcon
} from 'lucide-react';

/* ============================================================================
 * Stub-route copy registry — single source of truth for the
 * `<ComingSoonPage>` content rendered by every genuinely-not-yet-built Wave-1
 * route.
 *
 * Per-route copy is kept here (instead of duplicated in each page file) so
 * adding/refining a destination is a one-file edit. Each `STUB_ROUTES`
 * entry maps directly to `ComingSoonPageProps`.
 *
 * Routes whose capability already exists elsewhere (IC Memos → /diligence,
 * Deal Desk → /pipeline, Governance → /strategy, Trust Center →
 * /command-center, Action Queue → /notifications, Knowledge Base → /ask-earn)
 * no longer live here — those pages `redirect()` to the real surface, so the
 * rail is intentional rather than a dead-end.
 * ========================================================================= */

export interface StubRoute {
  area: string;
  title: string;
  blurb: string;
  capabilities: string[];
  icon: LucideIcon;
  stageLabel?: string;
}

export const STUB_ROUTES: Record<string, StubRoute> = {
  '/match-inbox': {
    area: 'Daily Execution',
    title: 'Match Inbox',
    blurb:
      "A daily triage of scored LP ↔ fund and deal ↔ mandate matches. Accept to spawn a pipeline entry; dismiss to teach Earn's filter.",
    capabilities: [
      'Score on thesis fit, check size, geography, mandate, and warmth.',
      'Accept creates a fully-loaded LP Pipeline or Deal Desk entry.',
      'Dismiss trains the filter so tomorrow’s matches sharpen.',
      'Every match carries an explainable rationale — no black box.'
    ],
    icon: Inbox,
    stageLabel: 'Source LPs / Source deals'
  },
  '/capital-stack': {
    area: 'Capital Formation',
    title: 'Capital Stack',
    blurb:
      'The live capital structure of your raise — target vs. soft-circled vs. committed vs. closed, broken out by LP type and tranche.',
    capabilities: [
      'Roll up allocations into one capital structure view.',
      'Track gap-to-close with the LPs most likely to fill it.',
      'Feed the Dashboard’s raise-progress directly from this surface.',
      'Versioned snapshots make every close moment reproducible.'
    ],
    icon: Layers,
    stageLabel: 'Convert LPs'
  },
  '/objections': {
    area: 'Capital Formation',
    title: 'Objections Library',
    blurb:
      'An objection library and resolution loop — fees, track record, team, strategy, timing — each tied to Earn-drafted rebuttals and conversion outcomes.',
    capabilities: [
      'Log each objection against its LP with full thread context.',
      'Earn drafts a tone-matched rebuttal, you review and send.',
      'Track resolved vs. open and correlate to conversion rate.',
      'Reusable knowledge — your fund’s objection-handling improves with every raise.'
    ],
    icon: MessagesSquare,
    stageLabel: 'Convert LPs'
  },
  '/inbox-intelligence': {
    area: 'Intelligence',
    title: 'Inbox Intelligence',
    blurb:
      'Earn reads your inbox and meeting transcripts to extract commitments, objections, and warm intros — and routes each one to the right place.',
    capabilities: [
      'Pull commitments out of email threads and meeting notes.',
      'File objections to the Objections library automatically.',
      'Surface warm intros into the LP Pipeline with provenance.',
      'Every extraction is reviewable — Earn never invents context.'
    ],
    icon: Mail,
    stageLabel: 'Operate & leverage'
  },
  '/materials': {
    area: 'Intelligence',
    title: 'Capital Materials Studio',
    blurb:
      'Generate decks, memos, and one-pagers directly from your Fund Profile — version-controlled, on-brand, and always tied to your latest numbers.',
    capabilities: [
      'Decks and one-pagers built from Source-of-Truth fields.',
      'Earn rewrites for any audience (LP, co-investor, internal IC).',
      'Versioned exports so every share is traceable.',
      'Materials auto-refresh when underlying data changes.'
    ],
    icon: FilePlus,
    stageLabel: 'Get raise-ready'
  },
  '/partners': {
    area: 'Intelligence',
    title: 'Partner Marketplace',
    blurb:
      'A directory of service providers and co-investors curated against your mandate — the relationships that move closes forward.',
    capabilities: [
      'Service-provider and co-investor profiles tied to your thesis.',
      'Warm-intro routing via your existing network graph.',
      'Performance signal — who delivers, who stalls.',
      'Marketplace stays private and audit-ready, like everything else.'
    ],
    icon: Handshake,
    stageLabel: 'Operate & leverage'
  },
  '/audit': {
    area: 'Audit',
    title: 'Memory Audit Trail',
    blurb:
      'An immutable, queryable log of every Earn action, agent output, and human decision — the institutional memory that makes the system compound.',
    capabilities: [
      'Every action attributed (Earn, specialist, teammate, you).',
      'Replay any decision with its inputs, model, and outputs.',
      'Filter by entity, stage, or specialist — answers in seconds.',
      'Provable institutional memory you carry across funds.'
    ],
    icon: History,
    stageLabel: 'Prove & compound'
  }
};
