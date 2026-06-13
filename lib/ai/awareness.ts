import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { computeCalibration } from '@/lib/queries/intelligence-calibration';
import { EARN_COO_SLUG, specialistLabel } from '@/lib/earn/routing';
import { OUTCOME_KINDS, type OutcomeKind } from '@/lib/earn/outcomes';

/* ----------------------------------------------------------------------------
 * Live workspace awareness — a compact, real-time snapshot of the operator's
 * book so Earn grounds guidance in their actual situation instead of generic
 * advice. This is the "self-aware of app state" facet: pipeline shape, in-flight
 * diligence, and relationship temperature, distilled to a few lines.
 *
 * Only counts, sums, stage labels, and scores are surfaced — never user-entered
 * free text (e.g. deal names) — so the snapshot is safe to place in the system
 * prompt without opening a prompt-injection surface. Every query runs through
 * the caller's RLS-scoped client and fails open: any error yields an empty
 * snapshot rather than blocking chat.
 * --------------------------------------------------------------------------*/

type Db = SupabaseClient<Database>;

// Pipeline stage keys → display labels (mirrors STAGE_ORDER in queries/pipeline).
const STAGE_LABELS: Record<string, string> = {
  visitor: 'Visitor',
  prospect: 'Prospect',
  qualified: 'Qualified',
  meeting: 'Meeting',
  diligence: 'Diligence',
  'soft-circle': 'Soft circle',
  committed: 'Committed',
  closed: 'Closed'
};
const STAGE_RANK = Object.keys(STAGE_LABELS);

/** Compact money: $4.2M, $850K, $0. Exported for unit tests. */
export function money(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

async function pipelineLine(supabase: Db, orgId: string): Promise<string | null> {
  const { data } = await supabase.from('deals').select('stage, status, amount').eq('org_id', orgId);
  if (!data || data.length === 0) return null;

  const active = data.filter((d) => d.status !== 'closed' && d.stage !== 'closed');
  if (active.length === 0) return null;

  const capital = active.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const byStage = new Map<string, number>();
  for (const d of active) byStage.set(d.stage, (byStage.get(d.stage) ?? 0) + 1);

  const stages = [...byStage.entries()]
    .sort((a, b) => STAGE_RANK.indexOf(a[0]) - STAGE_RANK.indexOf(b[0]))
    .map(([stage, n]) => `${STAGE_LABELS[stage] ?? stage} ${n}`)
    .join(', ');

  const noun = active.length === 1 ? 'active deal' : 'active deals';
  return `Pipeline: ${active.length} ${noun} worth ${money(capital)}; by stage — ${stages}.`;
}

async function diligenceLine(supabase: Db, orgId: string): Promise<string | null> {
  const [inFlightRes, lastDoneRes] = await Promise.all([
    supabase
      .from('diligence_runs')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('status', ['queued', 'running']),
    supabase
      .from('diligence_runs')
      .select('conviction')
      .eq('org_id', orgId)
      .eq('status', 'complete')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const inFlight = inFlightRes.count ?? 0;
  const lastConviction = lastDoneRes.data?.conviction ?? null;
  if (inFlight === 0 && lastConviction == null) return null;

  const parts: string[] = [];
  if (inFlight > 0) parts.push(`${inFlight} run${inFlight === 1 ? '' : 's'} in progress`);
  if (lastConviction != null) parts.push(`most recent completed conviction ${lastConviction}/100`);
  return `Diligence: ${parts.join('; ')}.`;
}

async function relationshipsLine(supabase: Db, orgId: string): Promise<string | null> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [hotRes, warmRes] = await Promise.all([
    supabase
      .from('relationships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'hot'),
    supabase
      .from('relationships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'warm')
      .gte('last_interaction_at', weekAgo)
  ]);

  const hot = hotRes.count ?? 0;
  const warm = warmRes.count ?? 0;
  if (hot === 0 && warm === 0) return null;
  return `Relationships: ${hot} hot, ${warm} warmed in the last 7 days.`;
}

/** Stage key → display label, falling back to the raw key. */
function dealStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/**
 * When the operator is focused on a specific deal, distil that deal's live
 * state — stage, size, status, and its latest diligence outcome — so Earn can
 * speak to the thing on screen rather than the book as a whole. Structured
 * fields only (stage / amount / status / conviction), never the deal's free
 * text, so it stays safe in the system prompt. Returns '' when the deal can't
 * be read (RLS / wrong id) so no block is emitted.
 */
export async function buildDealSnapshot(
  supabase: Db,
  orgId: string,
  dealId: string
): Promise<string> {
  try {
    const [dealRes, dilRes] = await Promise.all([
      supabase
        .from('deals')
        .select('stage, status, amount')
        .eq('org_id', orgId)
        .eq('id', dealId)
        .maybeSingle(),
      supabase
        .from('diligence_runs')
        .select('status, conviction')
        .eq('org_id', orgId)
        .eq('deal_id', dealId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    const deal = dealRes.data;
    if (!deal) return '';

    const facts = [`stage ${dealStage(deal.stage)}`];
    if (deal.amount != null && deal.amount > 0) facts.push(money(deal.amount));
    if (deal.status) facts.push(`status ${deal.status}`);

    const dil = dilRes.data;
    if (dil) {
      if (dil.status === 'complete' && dil.conviction != null) {
        facts.push(`diligence complete — conviction ${dil.conviction}/100`);
      } else if (dil.status === 'queued' || dil.status === 'running') {
        facts.push('diligence in progress');
      } else if (dil.status === 'error') {
        facts.push('last diligence run errored');
      }
    } else {
      facts.push('no diligence run yet');
    }

    return `Focused deal (live state of the deal the operator is viewing): ${facts.join(', ')}.`;
  } catch {
    return '';
  }
}

/** Bucket a recency into a coarse, name-free phrase ("today" / "3 days ago" /
 *  "5 weeks ago"). Computed from a timestamp — the raw value is never echoed.
 *  Exported for unit tests. */
export function lastTouch(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  if (days === 0) return 'last touch today';
  if (days === 1) return 'last touch yesterday';
  if (days < 14) return `last touch ${days} days ago`;
  if (days < 60) return `last touch ${Math.round(days / 7)} weeks ago`;
  return `last touch ${Math.round(days / 30)} months ago`;
}

/**
 * When the operator is focused on an LP / relationship, distil that
 * relationship's live state — temperature, strength, touch count, and recency —
 * so Earn can speak to the person on screen rather than the book as a whole.
 * Mirrors {@link buildDealSnapshot}. Structured fields only (status / strength /
 * interaction_count / bucketed recency), never names or other free text, so it
 * stays safe in the system prompt with no prompt-injection surface. The focus
 * `entityId` is a `contacts.id` (see ContactDetailDrawer's lp EarnContext), and
 * `relationships` is keyed by `contact_id` — so resolve on `contact_id` first,
 * then fall back to `id`. Returns '' when nothing can be read (RLS / wrong id),
 * so no block is emitted.
 */
export async function buildRelationshipSnapshot(
  supabase: Db,
  orgId: string,
  entityId: string
): Promise<string> {
  try {
    const cols = 'status, strength, interaction_count, last_interaction_at';
    let { data } = await supabase
      .from('relationships')
      .select(cols)
      .eq('org_id', orgId)
      .eq('contact_id', entityId)
      .maybeSingle();
    // Fall back to the relationships row id in case focus ever carries that.
    if (!data) {
      ({ data } = await supabase
        .from('relationships')
        .select(cols)
        .eq('org_id', orgId)
        .eq('id', entityId)
        .maybeSingle());
    }
    if (!data) return '';

    const facts: string[] = [];
    if (data.status) facts.push(`relationship ${data.status}`); // hot / warm / cold
    if (data.strength != null) facts.push(`strength ${data.strength}/100`);
    if (data.interaction_count != null) {
      facts.push(`${data.interaction_count} interaction${data.interaction_count === 1 ? '' : 's'}`);
    }
    const touch = lastTouch(data.last_interaction_at);
    if (touch) facts.push(touch);
    if (facts.length === 0) return '';

    return `Focused relationship (live state of the LP the operator is viewing): ${facts.join(', ')}.`;
  } catch {
    return '';
  }
}

/**
 * Build a few-line snapshot of the operator's live workspace, or '' when there
 * is nothing material yet (a brand-new org). Sections run in parallel and each
 * fails open independently, so a single slow/broken query never sinks the rest.
 */
export async function buildWorkspaceSnapshot(supabase: Db, orgId: string): Promise<string> {
  const [pipeline, diligence, relationships] = await Promise.all([
    pipelineLine(supabase, orgId).catch(() => null),
    diligenceLine(supabase, orgId).catch(() => null),
    relationshipsLine(supabase, orgId).catch(() => null)
  ]);

  const lines = [pipeline, diligence, relationships].filter((l): l is string => l != null);
  if (lines.length === 0) return '';
  return lines.map((l) => `- ${l}`).join('\n');
}

/** Max chars of the pre-generated brief we fold into Earn's grounding. */
const BRIEF_MAX_CHARS = 700;

/**
 * Surface the org's already-computed intelligence brief so conversational Earn
 * reflects the backend flywheel (the `generate_signal_matches` /
 * `intelligence_briefings` pipeline) instead of recomputing or ignoring it.
 *
 * The brief `body` is first-party, system-generated text (not operator free
 * text), summarising live market + match signals; we reference it rather than
 * re-derive it. `intelligence_briefings` is additive and not in the generated
 * types yet, so we read through a narrow typed escape. Fails open to '' (no
 * brief / read error) so it never blocks a chat turn.
 */
export async function buildIntelligenceGrounding(supabase: Db, orgId: string): Promise<string> {
  const reader = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string
        ) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        };
      };
    };
  };

  try {
    const { data, error } = await reader
      .from('intelligence_briefings')
      .select('body, match_count, top_score')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error || !data || typeof data.body !== 'string' || !data.body.trim()) return '';

    const body = data.body.trim().slice(0, BRIEF_MAX_CHARS);
    const matchCount = typeof data.match_count === 'number' ? data.match_count : 0;
    const topScore = typeof data.top_score === 'number' ? data.top_score : null;

    const signals =
      matchCount > 0
        ? `\nSignals: ${matchCount} new match${matchCount === 1 ? '' : 'es'} surfaced${
            topScore != null ? `, top fit ${topScore}/100` : ''
          }.`
        : '';

    return `Today's intelligence brief (already generated for this operator from live market + match signals — reference it, don't recompute):\n${body}${signals}`;
  } catch {
    return '';
  }
}

/**
 * Surface the org's adaptive match flywheel — top signal matches awaiting
 * review plus the model's calibration confidence — so Earn can *propose* acting
 * on them (review/act in the match inbox via the navigate tool) rather than
 * leaving them to the backend alone.
 *
 * Structured fields only (counts / scores / calibration stage) — never the
 * match rationale free text — so it stays injection-safe in the system prompt.
 * Reuses the pure `computeCalibration` (stage derives from accept/dismiss
 * decisions; factors not needed here). Fails open to '' so it never blocks chat.
 */
export async function buildMatchGrounding(supabase: Db, orgId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('matches')
      .select('score, status')
      .eq('org_id', orgId)
      .eq('kind', 'signal')
      .order('score', { ascending: false })
      .limit(100);
    if (!data || data.length === 0) return '';

    const awaiting = data.filter((m) => m.status !== 'accepted' && m.status !== 'dismissed');
    const cal = computeCalibration(data.map((m) => ({ score: m.score, status: m.status })));

    const parts: string[] = [];
    if (awaiting.length > 0) {
      const topOpen = Math.max(...awaiting.map((m) => m.score ?? 0));
      parts.push(
        `${awaiting.length} signal match${awaiting.length === 1 ? '' : 'es'} awaiting review` +
          (topOpen > 0 ? `, top fit ${topOpen}/100` : '')
      );
    }
    if (cal.decisions > 0) {
      const pct = Math.round(cal.acceptanceRate * 100);
      parts.push(
        `match calibration ${cal.stage} (${cal.decisions} decision${
          cal.decisions === 1 ? '' : 's'
        }, ${pct}% accepted)`
      );
    }
    if (parts.length === 0) return '';

    return `Match inbox (the operator's adaptive match flywheel — when relevant, propose reviewing or acting on these in the match inbox):\n- ${parts.join('.\n- ')}.`;
  } catch {
    return '';
  }
}

/* ----------------------------------------------------------------------------
 * Specialist memory — the routing flywheel made real.
 *
 * Every ask routes to a desk (see lib/earn/routing.ts); this is what makes the
 * relay compound. It reads the desk's prior outcomes off the Earn ledger
 * (`earn_outcomes`) and folds them in as continuity, so the tenth time the
 * operator asks Sloane about the raise she is standing on nine prior answers
 * rather than starting cold.
 *
 * Injection-safe by construction: only kind tallies + recency are surfaced —
 * never the user-entered titles — matching this module's no-free-text rule.
 * `earn_outcomes` isn't in the generated types, so we read through a narrow
 * typed escape (same pattern as the queries layer). Fails open to '' .
 * --------------------------------------------------------------------------*/

/** Compact age (e.g. "today", "3 days ago") from an ISO timestamp. */
function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const days = Math.floor(Math.max(0, Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export async function buildSpecialistMemory(
  supabase: Db,
  orgId: string,
  slug: string
): Promise<string> {
  // Earn synthesises across every desk — there is no single-desk memory to load.
  if (!slug || slug === EARN_COO_SLUG) return '';
  try {
    const reader = supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (
            col: string,
            val: string
          ) => {
            eq: (
              col: string,
              val: string
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean }
              ) => {
                limit: (
                  n: number
                ) => Promise<{ data: { kind: string; created_at: string }[] | null }>;
              };
            };
          };
        };
      };
    };
    const { data } = await reader
      .from('earn_outcomes')
      .select('kind, created_at')
      .eq('org_id', orgId)
      .eq('specialist_slug', slug)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data || data.length === 0) return '';

    const counts = new Map<string, number>();
    for (const r of data) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    const tally = [...counts.entries()]
      .map(([k, n]) => `${n} ${OUTCOME_KINDS[k as OutcomeKind]?.label ?? k}`)
      .join(', ');
    const label = specialistLabel(slug);

    return `${label}'s prior work on this mandate (continue it — do not re-introduce yourself or repeat past work): ${tally}. Most recent ${relativeAge(data[0]!.created_at)}. Reference this as ongoing work and build the next step on top of it.`;
  } catch {
    return '';
  }
}
