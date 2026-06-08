import { FilePlus, type LucideIcon } from 'lucide-react';

/* ============================================================================
 * Stub-route copy registry — single source of truth for the
 * `<ComingSoonPage>` content rendered by every genuinely-not-yet-built Wave-1
 * route.
 *
 * Per-route copy is kept here (instead of duplicated in each page file) so
 * adding/refining a destination is a one-file edit. Each `STUB_ROUTES`
 * entry maps directly to `ComingSoonPageProps`.
 *
 * Keep this registry in lockstep with `rail-nav.ts`: a route belongs here ONLY
 * while its page renders `<ComingSoonPage>` (i.e. it is NOT `live` on the rail).
 * The moment a route ships a real surface, delete its entry — otherwise the
 * dead copy invites someone to re-point a live route back at a stub.
 *
 * Routes whose capability already exists elsewhere (IC Memos → /diligence,
 * Deal Desk → /pipeline, Governance → /strategy, Trust Center →
 * /command-center, Action Queue → /notifications, Knowledge Base → /ask-earn)
 * `redirect()` to the real surface instead of stubbing, so the rail is
 * intentional rather than a dead-end.
 *
 * As of the live build, Match Inbox, Capital Stack, Objections, Partner
 * Marketplace, Inbox Intelligence, and the Memory Audit Trail all ship real
 * surfaces — so `/materials` (Capital Materials Studio) is the only remaining
 * genuine stub.
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
  '/materials': {
    area: 'Intelligence',
    title: 'Capital Materials Studio',
    blurb:
      'Generate decks, memos, and one-pagers directly from your Profile — version-controlled, on-brand, and always tied to your latest numbers.',
    capabilities: [
      'Decks and one-pagers built from Source-of-Truth fields.',
      'Earn rewrites for any audience (LP, co-investor, internal IC).',
      'Versioned exports so every share is traceable.',
      'Materials auto-refresh when underlying data changes.'
    ],
    icon: FilePlus,
    stageLabel: 'Get raise-ready'
  }
};
