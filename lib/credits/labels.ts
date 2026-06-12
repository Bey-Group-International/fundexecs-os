/* ============================================================================
 * lib/credits/labels.ts — human labels for `credit_transactions.reason`.
 *
 * Plain module (NOT `server-only`): the wallet ledger renders client-side, so
 * this must import nothing server-bound. `reason` strings are written by the
 * metering seam (action ids from costs.ts), the monthly grant
 * (`monthly_grant:YYYY-MM`), top-ups, gifts, and referral payouts — this maps
 * each to a friendly label, falling back to a title-cased version of the raw
 * reason so an unmapped reason still reads cleanly.
 * ========================================================================= */

/** Exact-match labels for the metered actions + the well-known credit sources. */
const REASON_LABELS: Record<string, string> = {
  // Owned compute.
  earn_chat: 'Earn chat',
  lp_fit_score: 'LP fit score',
  deck_review: 'Deck review',
  objection_handler: 'Objection handler',
  outreach_generate: 'Outreach draft',
  diligence_run: 'Diligence run',
  lp_discovery: 'LP discovery',
  target_discovery: 'Target discovery',
  workflow_step: 'Workflow step',
  team_task_run: 'Team automation',
  // Paid integrations.
  apollo_enrich: 'Apollo enrichment',
  meeting_copilot: 'Meeting copilot',
  docusign_envelope: 'DocuSign envelope',
  carta_sync: 'Carta sync',
  // Credit sources.
  topup: 'Credit top-up',
  grant: 'Credit grant'
};

/** Prefix-matched labels for reasons that carry a scope suffix (e.g. a month). */
const REASON_PREFIXES: { prefix: string; label: string }[] = [
  { prefix: 'monthly_grant', label: 'Monthly grant' },
  { prefix: 'referral', label: 'Referral reward' },
  { prefix: 'gift', label: 'Gift credits' }
];

/** Title-case a raw reason id (`some_reason:scope` → `Some reason`). */
function humanize(reason: string): string {
  const base = reason.split(':')[0]?.replace(/[_-]+/g, ' ').trim() ?? reason;
  if (!base) return reason;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Friendly label for a `credit_transactions.reason`. Never throws. */
export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Adjustment';
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  const prefixed = REASON_PREFIXES.find((p) => reason.startsWith(p.prefix));
  if (prefixed) return prefixed.label;
  return humanize(reason);
}
