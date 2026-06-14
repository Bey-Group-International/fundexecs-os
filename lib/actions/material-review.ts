'use server';

import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile, type FundProfile } from '@/lib/queries/fund-profile';
import { reviewMaterialWithEarn } from '@/lib/ai/material-review';
import type { MaterialReviewResult } from '@/lib/capital-formation/material-review';

/* ============================================================================
 * lib/actions/material-review.ts — review the raise narrative like an LP.
 *
 * The app's authored substance lives in the Source of Truth (thesis, strategy,
 * track record, team, terms). This assembles that into the narrative an LP
 * actually reads and asks Earn to review it like a skeptical institutional
 * allocator — the "review my deck like an LP" fast win over existing data.
 * Returns the review for the operator; nothing is persisted.
 * ========================================================================= */

function money(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Assemble the reviewable raise narrative from the Source of Truth. */
function buildNarrative(profile: FundProfile): string {
  const lines: string[] = [`# ${profile.fundName}`];
  if (profile.headline) lines.push(profile.headline);
  if (profile.thesis) lines.push(`\n## Thesis\n${profile.thesis}`);
  if (profile.strategy) lines.push(`\n## Strategy\n${profile.strategy}`);
  if (profile.targetRaise) lines.push(`\n## Target raise\n${money(profile.targetRaise)}`);

  const terms = [
    profile.terms.structure ? `Structure: ${profile.terms.structure}` : null,
    profile.terms.managementFeePct != null
      ? `Management fee: ${profile.terms.managementFeePct}%`
      : null,
    profile.terms.carryPct != null ? `Carry: ${profile.terms.carryPct}%` : null
  ].filter(Boolean);
  if (terms.length) lines.push(`\n## Terms\n${terms.join(' · ')}`);

  const tr = profile.trackRecord;
  const trackParts = [
    tr.priorDeals != null ? `${tr.priorDeals} prior deals` : null,
    tr.returnsSummary,
    tr.highlights
  ].filter(Boolean);
  if (trackParts.length) lines.push(`\n## Track record\n${trackParts.join('. ')}`);

  if (profile.team.length) {
    lines.push(
      `\n## Team\n${profile.team.map((m) => (m.role ? `${m.name} — ${m.role}` : m.name)).join('; ')}`
    );
  }

  // Pull in any substantive profile sections the LP would read.
  for (const s of profile.sections) {
    if (!s.present) continue;
    if (s.text) lines.push(`\n## ${s.label}\n${s.text}`);
    else if (s.tags.length) lines.push(`\n## ${s.label}\n${s.tags.join(', ')}`);
  }

  return lines.join('\n');
}

export type ReviewNarrativeResult =
  | { ok: true; result: MaterialReviewResult; thin: boolean }
  | { ok: false; error: string };

export async function reviewRaiseNarrative(): Promise<ReviewNarrativeResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const profile = await getFundProfile(org.orgId);
  const narrative = buildNarrative(profile);

  // "Thin" when there's little beyond the name — the review will say so, but we
  // also flag it so the UI can nudge the operator to fill the Source of Truth.
  const thin = narrative.trim().length < 120;

  const result = await reviewMaterialWithEarn({
    kindLabel: 'Raise narrative',
    audienceLabel: 'Limited partners',
    title: profile.fundName,
    body: narrative,
    fund: {
      name: profile.fundName,
      thesis: profile.thesis,
      strategy: profile.strategy
    }
  });

  return { ok: true, result, thin };
}
