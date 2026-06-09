import type { LucideIcon } from 'lucide-react';

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
 * As of the live build, Match Inbox, Capital Stack, Materials Studio,
 * Objections, Partner Marketplace, Inbox Intelligence, and the Memory Audit
 * Trail all ship real surfaces. Keep this object empty until a new route
 * intentionally ships as a visible placeholder.
 * ========================================================================= */

export interface StubRoute {
  area: string;
  title: string;
  blurb: string;
  capabilities: string[];
  icon: LucideIcon;
  stageLabel?: string;
}

export const STUB_ROUTES: Record<string, StubRoute> = {};
