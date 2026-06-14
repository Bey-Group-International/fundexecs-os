import type { DiligenceRunDetail } from '@/lib/queries/diligence';

/* ============================================================================
 * lib/diligence/memo.ts — compose an IC memo from a completed diligence run.
 *
 * Deterministic assembly (no LLM call): the 7-agent committee already produced
 * the analysis — the conviction, the synthesis memo + recommendation, and one
 * scored finding per analytical lane. This turns those rows into a structured,
 * citable investment memo. Because every section is built from a real finding,
 * provenance can't be hallucinated: each claim is attributed to the lane and
 * specialist that produced it.
 * ========================================================================= */

export interface ComposedMemo {
  title: string;
  body: string;
}

function scoreText(score: number | null): string {
  return typeof score === 'number' ? `${score}/100` : '—';
}

/** Build the IC memo for a completed run. Pure + total — safe to unit test. */
export function composeMemo(run: DiligenceRunDetail): ComposedMemo {
  const subject = run.dealName?.trim() || 'Diligence run';
  const title = `Investment Memo — ${subject}`;

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');

  // Headline: recommendation + conviction from the synthesis verdict.
  const conviction = run.synthesis?.conviction ?? run.conviction;
  lines.push('## Recommendation');
  lines.push('');
  lines.push(run.synthesis?.recommendation?.trim() || 'No recommendation recorded.');
  lines.push('');
  lines.push(`**Conviction:** ${scoreText(conviction)}`);
  lines.push('');

  // Scorecard: one row per analytical lane.
  if (run.analysts.length > 0) {
    lines.push('## Diligence scorecard');
    lines.push('');
    lines.push('| Lane | Specialist | Score |');
    lines.push('| --- | --- | --- |');
    for (const a of run.analysts) {
      lines.push(`| ${a.laneLabel} | ${a.personaLabel} | ${scoreText(a.score)} |`);
    }
    lines.push('');
  }

  // The synthesis memo body, verbatim from the committee.
  if (run.synthesis?.memo?.trim()) {
    lines.push('## Synthesis');
    lines.push('');
    lines.push(run.synthesis.memo.trim());
    lines.push('');
  }

  // Per-lane findings — each cites its lane + specialist (real provenance).
  if (run.analysts.length > 0) {
    lines.push('## Findings by lane');
    lines.push('');
    for (const a of run.analysts) {
      lines.push(`### ${a.laneLabel} — ${scoreText(a.score)}`);
      lines.push('');
      lines.push(`*${a.personaLabel}*`);
      lines.push('');
      if (a.summary.trim()) lines.push(a.summary.trim());
      if (a.detail?.trim()) {
        lines.push('');
        lines.push(a.detail.trim());
      }
      lines.push('');
    }
  }

  // Open items the committee flagged.
  const followUps = run.synthesis?.followUpQuestions ?? [];
  if (followUps.length > 0) {
    lines.push('## Open questions');
    lines.push('');
    for (const q of followUps) lines.push(`- ${q}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `_Generated from diligence run ${run.id} on ${new Date(run.createdAt).toLocaleDateString()}. Every section is drawn from the committee's recorded findings._`
  );

  return { title, body: lines.join('\n') };
}
