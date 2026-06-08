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

/** Compact money: $4.2M, $850K, $0. */
function money(n: number): string {
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
