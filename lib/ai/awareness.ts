import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

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
