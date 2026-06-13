/* ============================================================================
 * lib/tasklets/evaluate — the honest signal → tasklet evaluators.
 *
 * Pure functions, no IO: each takes the real rows a signal source produced and
 * returns approve-ready `TaskletDraft`s. The queries layer does the reads and
 * the idempotent upsert; keeping the mapping pure makes the rules trivially
 * unit-testable and guarantees the honest-data contract — a tasklet can only
 * be built from a row that actually exists.
 *
 * Routing is by `OUTCOME_KINDS[kind].specialistSlug`, so a tasklet's desk is
 * the same desk that produces that outcome on the Earn ledger. No new
 * vocabulary — tasklets reuse the eight outcome kinds verbatim.
 * ========================================================================= */

import { OUTCOME_KINDS } from '@/lib/earn/outcomes';
import type { TaskletDraft } from './types';

/* -- 1. Relationship inbox (Gmail · Calendar · Slack → inbox_items) --------- */

export interface InboxSignalRow {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  preview: string | null;
  draft_reply: string | null;
  contact_id: string | null;
  deal_id: string | null;
}

/**
 * An inbound conversation waiting on the operator → Eleanor drafts the reply.
 * Only inbound items arm a tasklet (an outbound message needs no follow-up
 * from us). Uses the scorer's `draft_reply` when present, else a plain prompt.
 */
export function inboxTasklets(rows: InboxSignalRow[]): TaskletDraft[] {
  const kind = 'lp_letter' as const;
  return rows
    .filter((r) => r.direction === 'inbound')
    .map((r) => ({
      dedupeKey: `inbox:${r.id}`,
      signalSource: 'inbox' as const,
      signalSummary: r.subject
        ? `Inbound ${r.channel} — “${r.subject}” is waiting on a reply.`
        : `An inbound ${r.channel} conversation is waiting on a reply.`,
      kind,
      specialistSlug: OUTCOME_KINDS[kind].specialistSlug,
      title: r.subject ? `Reply: ${r.subject}` : 'Draft a reply to this conversation',
      draft:
        r.draft_reply?.trim() ||
        'Draft a reply that answers what they asked and moves the conversation forward.',
      homeSurface: 'Inbox',
      homeHref: '/inbox',
      entityType: 'inbox_item',
      entityId: r.id,
      metadata: { channel: r.channel, dealId: r.deal_id, contactId: r.contact_id }
    }));
}

/* -- 2. Operating-loop telemetry (loop_events) ----------------------------- */

export interface LoopSignalRow {
  id: string;
  verb: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
}

/**
 * A deal reaching a committed/closing state → Sterling opens and sequences the
 * close. Conservative on purpose: only fires for deal entities whose event
 * names a commit/close, so loop telemetry noise (launcher_opened, gate_cleared)
 * never arms a tasklet. Unknown events yield nothing — honest by omission.
 */
export function loopEventTasklets(rows: LoopSignalRow[]): TaskletDraft[] {
  const kind = 'closing_opened' as const;
  const out: TaskletDraft[] = [];
  for (const r of rows) {
    if (r.entity_type !== 'deal' || !r.entity_id) continue;
    const et = r.event_type.toLowerCase();
    if (!et.includes('commit') && !et.includes('clos')) continue;
    out.push({
      dedupeKey: `loop:${r.id}`,
      signalSource: 'loop_event',
      signalSummary: `A deal reached "${r.event_type.replace(/_/g, ' ')}" — time to sequence the close.`,
      kind,
      specialistSlug: OUTCOME_KINDS[kind].specialistSlug,
      title: 'Open and sequence the closing',
      draft: 'Open the closing checklist for this deal and sequence the steps through to signed.',
      homeSurface: 'Closings',
      homeHref: '/execute/closings',
      entityType: 'deal',
      entityId: r.entity_id,
      metadata: { eventType: r.event_type, verb: r.verb }
    });
  }
  return out;
}

/* -- 3. Public inbound funnel (deal_submissions / deal_interest_captures) --- */

export interface DealSubmissionRow {
  id: string;
  company_name: string;
  stage: string | null;
  raise_amount: number | null;
  founder_name: string | null;
  founder_email: string | null;
  status: string;
}

/**
 * A founder submitted a deal through the public page → Marcus scores it against
 * the mandate and requests anything missing. Only `pending` submissions arm a
 * tasklet (reviewed/accepted/declined are already handled).
 */
export function submissionTasklets(rows: DealSubmissionRow[]): TaskletDraft[] {
  const kind = 'target_scored' as const;
  return rows
    .filter((r) => r.status === 'pending')
    .map((r) => {
      const who = r.founder_name?.trim() || 'A founder';
      const stage = r.stage ? ` (${r.stage})` : '';
      return {
        dedupeKey: `submission:${r.id}`,
        signalSource: 'public_surface' as const,
        signalSummary: `${who} submitted ${r.company_name} through your public page.`,
        kind,
        specialistSlug: OUTCOME_KINDS[kind].specialistSlug,
        title: `Score inbound: ${r.company_name}`,
        draft: `Score ${r.company_name}${stage} against the mandate, flag the gaps, and request anything missing from ${r.founder_email ?? 'the founder'}.`,
        homeSurface: 'Deal Pipeline',
        homeHref: '/source/pipeline',
        entityType: 'deal_submission',
        entityId: r.id,
        metadata: {
          companyName: r.company_name,
          stage: r.stage,
          raiseAmount: r.raise_amount,
          founderEmail: r.founder_email
        }
      };
    });
}

/* -- 4. Warmth threshold → HighLevel sequence enrollment (inbox_items) ------ */

export interface WarmthSignalRow {
  id: string;
  channel: string;
  subject: string | null;
  preview: string | null;
  score: number;
  contact_id: string | null;
  deal_id: string | null;
}

const HL_ENROLL_THRESHOLD = 75;

/**
 * High-warmth inbox items that haven't triggered an enrollment yet. Each
 * produces a reactivation tasklet: operator approves → HighLevel enrolls the
 * contact in the appropriate nurture sequence. Gated by score threshold so
 * routine low-signal items never reach the queue.
 */
export function warmthEnrollTasklets(rows: WarmthSignalRow[]): TaskletDraft[] {
  const kind = 'reactivation' as const;
  return rows
    .filter((r) => r.score >= HL_ENROLL_THRESHOLD && !!r.contact_id)
    .map((r) => ({
      dedupeKey: `hl_enroll:${r.id}`,
      signalSource: 'inbox' as const,
      signalSummary: r.subject
        ? `High-warmth ${r.channel} — "${r.subject}" scored ${r.score}/100.`
        : `High-warmth ${r.channel} signal scored ${r.score}/100 — ready for nurture.`,
      kind,
      specialistSlug: OUTCOME_KINDS[kind].specialistSlug,
      title: r.subject ? `Enroll in HL sequence: ${r.subject}` : 'Enroll contact in HL nurture sequence',
      draft:
        'This contact scored above the warmth threshold. Approve to enroll them in the appropriate HighLevel nurture sequence based on their relationship stage.',
      homeSurface: 'Inbox',
      homeHref: '/inbox',
      entityType: 'inbox_item',
      entityId: r.id,
      metadata: {
        hlEnroll: true,
        score: r.score,
        channel: r.channel,
        contactId: r.contact_id,
        dealId: r.deal_id
      }
    }));
}

export interface DealInterestRow {
  id: string;
  deal_id: string;
  name: string;
  email: string;
  note: string | null;
}

/**
 * An LP registered interest in a public raise → Eleanor opens the conversation
 * while the interest is warm.
 */
export function interestTasklets(rows: DealInterestRow[]): TaskletDraft[] {
  const kind = 'lp_letter' as const;
  return rows.map((r) => ({
    dedupeKey: `interest:${r.id}`,
    signalSource: 'public_surface' as const,
    signalSummary: `${r.name} registered interest in a public raise.`,
    kind,
    specialistSlug: OUTCOME_KINDS[kind].specialistSlug,
    title: `Follow up: ${r.name} (interested LP)`,
    draft: `Thank ${r.name} for their interest, answer their note, and open the conversation toward a meeting.`,
    homeSurface: 'Deal Pipeline',
    homeHref: '/source/pipeline',
    entityType: 'deal_interest_capture',
    entityId: r.id,
    metadata: { dealId: r.deal_id, email: r.email, note: r.note }
  }));
}
