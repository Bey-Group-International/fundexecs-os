/**
 * LP Room — typed prop contracts.
 *
 * Every component under `app/lp-room/*` and `components/lp-room/*` is driven
 * by these typed props. Backend wiring lands later: Claude maps each contract
 * onto its query / server action and removes the fixture defaults.
 *
 * Voice anchor: Eleanor — Head of Investor Relations. Sections use the live
 * www.fundexecs.com brand voice ("on the record", "audit-ready", "documented
 * as it forms"). No backend imports cross into this folder.
 */

/* ----------------------------------------------------------------------------
 * FundOverviewCard
 * --------------------------------------------------------------------------*/

export type FundStatus = 'open' | 'in-market' | 'closed' | 'wound-down';

export interface FundOverview {
  /** Display name of the fund (e.g. "FundExecs Capital I"). */
  name: string;
  /** Vintage year (e.g. 2026). */
  vintage: number;
  /** Strategy label (e.g. "Lower-middle-market growth"). */
  strategy: string;
  /** Pre-formatted target size (e.g. "$120M"). */
  sizeTarget: string;
  /** Pre-formatted committed amount (e.g. "$72M"). */
  committed: string;
  /** Pre-formatted called amount (e.g. "$38M"). */
  called: string;
  /** Distributions to paid-in (e.g. "0.42x"). */
  dpi?: string;
  /** Total value to paid-in (e.g. "1.18x"). */
  tvpi?: string;
  /** Net IRR (e.g. "21.4%"). */
  irr?: string;
  /** Date of next close (e.g. "Mar 21, 2026" or "TBD"). */
  nextClose?: string;
  /** Status badge tone. */
  status: FundStatus;
  /** Optional one-liner that appears under the title. */
  oneLiner?: string;
}

/* ----------------------------------------------------------------------------
 * DocumentVaultList
 * --------------------------------------------------------------------------*/

export type LpDocumentKind =
  | 'lpa'
  | 'side-letter'
  | 'subscription'
  | 'report'
  | 'k1'
  | 'capital-call'
  | 'distribution-notice'
  | 'memo'
  | 'other';

export type LpDocumentAccess = 'committed' | 'prospect' | 'admin-only';

export interface LpDocument {
  id: string;
  /** File label as shown to the LP. */
  name: string;
  kind: LpDocumentKind;
  /** Pre-formatted file size ("2.1 MB"). */
  sizeMb: string;
  /** ISO date or short label ("Feb 12, 2026"). */
  uploadedAt: string;
  /** Whether the doc is signed / countersigned / unsigned. */
  signed?: boolean;
  /** Access tier needed to view. */
  accessLevel: LpDocumentAccess;
}

/* ----------------------------------------------------------------------------
 * UpdateFeed
 * --------------------------------------------------------------------------*/

/** Lifecycle phase this update belongs to — used to tint the dot per the
 *  live www.fundexecs.com four-step lifecycle. */
export type LpUpdateLifecycle =
  | 'mandate'
  | 'source-raise'
  | 'analyze-package'
  | 'communicate-close'
  | 'reporting';

export interface LpUpdateAttachment {
  id: string;
  name: string;
  /** Document id from `LpDocument` if this attachment is in the vault. */
  documentId?: string;
}

export interface LpUpdate {
  id: string;
  /** ISO date or short label ("Feb 14, 2026"). */
  postedAt: string;
  title: string;
  /** Markdown-safe body. The shell renders plain text. */
  body: string;
  /** Author display name (defaults to Eleanor). */
  author?: string;
  authorRole?: string;
  lifecycle: LpUpdateLifecycle;
  /** Documents attached to the update. */
  attachments?: LpUpdateAttachment[];
}

/* ----------------------------------------------------------------------------
 * CommitmentTracker
 * --------------------------------------------------------------------------*/

export interface CommitmentScheduleRow {
  id: string;
  /** Persona key from `components/dashboard/fixtures/personas.ts`. */
  persona: string;
  /** Anonymized initials ("J.R."). */
  initials: string;
  /** City. */
  city: string;
  /** Pre-formatted committed amount ("$2.0M"). */
  committed: string;
  /** Pre-formatted called amount ("$1.2M"). */
  called: string;
  /** Status badge label. */
  status: 'committed' | 'called' | 'distributed' | 'in-progress';
  /** ISO date label ("Feb 2026"). */
  when: string;
}

export interface CommitmentSnapshot {
  /** Pre-formatted total commitments ("$72M"). */
  committed: string;
  /** Pre-formatted called capital ("$38M"). */
  called: string;
  /** Pre-formatted distributions ("$12M"). */
  distributed: string;
  /** Pre-formatted remaining unfunded ("$34M"). */
  remaining: string;
  /** Per-LP rows. */
  schedule: CommitmentScheduleRow[];
}

/* ----------------------------------------------------------------------------
 * LpQAChat
 * --------------------------------------------------------------------------*/

export type LpQuestionStatus = 'open' | 'answered' | 'archived';

export interface LpAnswer {
  id: string;
  /** Display name of the answerer (defaults to Eleanor). */
  author: string;
  /** Role line below the name. */
  authorRole?: string;
  /** ISO date or short label ("Feb 14, 2026 · 3:42pm"). */
  postedAt: string;
  /** Plaintext body. */
  body: string;
  /** Citations / source refs surfaced by Earn. */
  citations?: { id: string; label: string }[];
}

export interface LpQuestion {
  id: string;
  /** Anonymized asker label ("J.R. · Family Office"). */
  askedBy: string;
  askedAt: string;
  /** Plaintext body. */
  body: string;
  status: LpQuestionStatus;
  /** Threaded answers (ordered chronologically). */
  thread: LpAnswer[];
}

/** Draft payload emitted by the composer. The shell only validates that
 *  `body` is non-empty; backend wires `onSubmit` to a server action later. */
export interface LpQuestionDraft {
  body: string;
  /** Optional override asker label — defaults to the signed-in identity. */
  askerName?: string;
}

/* ----------------------------------------------------------------------------
 * Page-level composition prop
 * --------------------------------------------------------------------------*/

export interface LpRoomData {
  fund: FundOverview;
  documents: LpDocument[];
  updates: LpUpdate[];
  commitments: CommitmentSnapshot;
  questions: LpQuestion[];
}
