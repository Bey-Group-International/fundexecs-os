import {
  IdCard,
  ShieldCheck,
  ListChecks,
  Inbox,
  Layers,
  MessagesSquare,
  Briefcase,
  FileSignature,
  Scale,
  Mail,
  BookOpenText,
  FilePlus,
  Handshake,
  History,
  type LucideIcon
} from 'lucide-react';

/* ============================================================================
 * Stub-route copy registry — single source of truth for the
 * `<ComingSoonPage>` content rendered by every not-yet-built Wave-1 route.
 *
 * Per-route copy is kept here (instead of duplicated in 14 page files) so
 * adding/refining a destination is a one-file edit. Each `STUB_ROUTES`
 * entry maps directly to `ComingSoonPageProps`.
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
  '/profile': {
    area: 'Source of Truth',
    title: 'Fund Profile',
    blurb:
      'The canonical fund and manager record everything else reads from — thesis, strategy, terms, track record, team — with a credibility score an LP would actually trust.',
    capabilities: [
      'Surface a 0–100 credibility score with the exact gaps an LP would probe.',
      'Feed Dashboard readiness, outreach copy, and IC memos from one source.',
      'Earn keeps the record current and flags weak spots before they cost a close.',
      'Every edit lands on the record — auditable, versioned, reversible.'
    ],
    icon: IdCard,
    stageLabel: 'Establish truth'
  },
  '/trust': {
    area: 'Source of Truth · Audit',
    title: 'Trust Center',
    blurb:
      'The four-layer Chain of Trust surfaced as a live ledger — every claim mapped to its proof, every proof mapped to the evidence behind it.',
    capabilities: [
      'See Proof of Truth · Concept · Execution · Work side-by-side with completion.',
      'Approve, reject, and version evidence with full provenance.',
      'Drop a citation into any LP conversation — Earn wires the receipt.',
      'Audit-ready exports built from the same ledger LPs read.'
    ],
    icon: ShieldCheck,
    stageLabel: 'Establish truth / Prove'
  },
  '/action-queue': {
    area: 'Daily Execution',
    title: 'Action Queue',
    blurb:
      "One prioritized, lifecycle-aware list of what to do next — Earn's recommendations and your notifications, merged and ranked by impact.",
    capabilities: [
      'Rank items by impact + urgency + lifecycle stage, not by arrival time.',
      'Delegate any item to Earn or a specialist with a single click.',
      'Snooze and re-surface items so nothing important goes silent.',
      'Closed items log to your Chain of Trust automatically.'
    ],
    icon: ListChecks,
    stageLabel: 'Operate & leverage'
  },
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
  '/deal-desk': {
    area: 'Deal Execution',
    title: 'Deal Desk',
    blurb:
      'The investment-opportunity pipeline — sourcing → screen → diligence → IC → deploy — paired with Earn and the diligence committee.',
    capabilities: [
      'A board that mirrors how investment committees actually work.',
      'Stage velocity, stuck-deal detection, and IC-ready summaries.',
      'Diligence committee runs server-side; results land here.',
      'Every deployment ties back to the Governance objective it advances.'
    ],
    icon: Briefcase,
    stageLabel: 'Source & execute deals'
  },
  '/ic-memos': {
    area: 'Deal Execution',
    title: 'IC Memos',
    blurb:
      'Formal investment-committee memos surfaced as a library tied to deals — the diligence Synthesis you already trust, organized for the actual decision.',
    capabilities: [
      'Auto-assembled memo from diligence findings, financials, and risk.',
      'Inline citations — every claim points to its proof in the Vault.',
      'Versioned drafts so reviewers can see what changed and why.',
      'Export the same memo IC pack you defend at the meeting.'
    ],
    icon: FileSignature,
    stageLabel: 'Source & execute deals'
  },
  '/governance': {
    area: 'Deal Execution',
    title: 'Governance Plan & Deployment',
    blurb:
      'The 100/30/10 objective framework applied to the fund and each deal — strategy in, accountability out.',
    capabilities: [
      'Cascade strategy down to deal-level objectives and milestones.',
      'Track deployment status against each governance objective.',
      'Earn flags drift before it shows up in returns.',
      'Single source of board-ready governance reporting.'
    ],
    icon: Scale,
    stageLabel: 'Operate & leverage'
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
  '/knowledge': {
    area: 'Intelligence',
    title: 'Knowledge Base',
    blurb:
      'The 15-specialist RAG over your own documents and history — ask any of the team a question and get an answer grounded in your operating reality.',
    capabilities: [
      'Query private documents, transcripts, and prior conversations.',
      'Each answer carries the citations Earn used to write it.',
      'Specialists handle their lane — Sterling on strategy, Eleanor on LPs, etc.',
      'Knowledge compounds — every closed action makes the next answer sharper.'
    ],
    icon: BookOpenText,
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
