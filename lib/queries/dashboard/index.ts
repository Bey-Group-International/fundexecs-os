import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/queries/auth';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { MemberType } from '@/lib/member-types';
import { MEMBER_TYPE_LABELS } from '@/lib/member-types';
import type { ChainOfTrustStanding } from '@/components/dashboard/ChainOfTrustStrip';

type S = SupabaseClient<Database>;

/* ============================================================================
 * Member-type personalized dashboards — typed loaders.
 *
 * Each `getXxxDashboardData(orgId, userId)` returns a narrowly typed payload
 * shaped by the layout. Every loader returns `{ data, empty, error }` so the
 * layout can branch into loading / empty / error states without bespoke
 * plumbing per type.
 *
 * The shared loader `getDashboardCommon` resolves the member identity strip
 * (name + position) and the Chain-of-Trust standing rendered in the hero.
 * ========================================================================= */

export type DashboardLoad<T> =
  | { data: T; empty: false; error?: undefined }
  | { data: T; empty: true; error?: undefined }
  | { data: null; empty: false; error: string };

function ok<T>(data: T, empty: boolean): DashboardLoad<T> {
  return { data, empty } as DashboardLoad<T>;
}
function fail<T>(error: string): DashboardLoad<T> {
  return { data: null, empty: false, error };
}

/* ---------- shared: member identity + Chain-of-Trust standing ----------- */

export interface DashboardCommon {
  member: {
    displayName: string;
    position: string;
    memberType: MemberType | null;
  };
  trust: ChainOfTrustStanding;
}

export async function getDashboardCommon(
  supabase: S,
  orgId: string,
  userId: string,
  memberType: MemberType | null,
  displayNameFallback: string
): Promise<DashboardCommon> {
  // Resolve display_name + headline from member_profiles. PK is user_id.
  const { data: mp } = await supabase
    .from('member_profiles')
    .select('user_id, display_name, headline')
    .eq('user_id', userId)
    .maybeSingle();

  const displayName = (mp?.display_name ?? '').trim() || displayNameFallback || 'Welcome';
  const position =
    (mp?.headline ?? '').trim() || (memberType ? MEMBER_TYPE_LABELS[memberType] : 'Member');

  // Pull the most recent chain_of_trust record attached to the member's
  // profile entity. entity_id is the member's user_id (PK of member_profiles).
  let trust: ChainOfTrustStanding = {
    hasRecord: false,
    truth: 0,
    concept: 0,
    execution: 0,
    work: 0,
    memberProfileId: userId,
    memberDisplayName: displayName
  };
  const { data: rec } = await supabase
    .from('chain_of_trust_records')
    .select('id, current_layer, completion_percentage')
    .eq('org_id', orgId)
    .eq('entity_type', 'member_profile')
    .eq('entity_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rec) {
    const { data: layers } = await supabase
      .from('proof_layers')
      .select('layer_name, completion_percentage')
      .eq('chain_record_id', rec.id);
    const pctOf = (name: string) => {
      const m = (layers ?? []).find((l) => (l.layer_name ?? '').toLowerCase().includes(name));
      return Math.max(0, Math.min(100, Math.round(Number(m?.completion_percentage ?? 0))));
    };
    // Map the live `current_layer` enum (Proof of Truth / Concept / Execution / Work)
    // back to the four-segment chip the strip renders.
    const currentLayerMap: Record<string, ChainOfTrustStanding['currentLayer']> = {
      'Proof of Truth': 'intent',
      'Proof of Concept': 'formation',
      'Proof of Execution': 'execution',
      'Proof of Work': 'work'
    };
    trust = {
      hasRecord: true,
      truth: pctOf('truth'),
      concept: pctOf('concept'),
      execution: pctOf('execution'),
      work: pctOf('work'),
      currentLayer: currentLayerMap[rec.current_layer ?? 'Proof of Truth'] ?? 'intent',
      recordId: rec.id,
      memberProfileId: userId,
      memberDisplayName: displayName
    };
  }

  return {
    member: { displayName, position, memberType },
    trust
  };
}

/* ---------- investment_firm ---------------------------------------------- */

export interface DealTrustRef {
  dealId: string;
  recordId: string;
  /** Layer label as stored, e.g. 'Proof of Truth'. */
  currentLayer: string;
  /** Layer short key for chip styling. */
  currentLayerKey: 'truth' | 'concept' | 'execution' | 'work';
  completionPercentage: number;
}

function layerShortKey(label: string | null | undefined): DealTrustRef['currentLayerKey'] {
  switch (label) {
    case 'Proof of Concept':
      return 'concept';
    case 'Proof of Execution':
      return 'execution';
    case 'Proof of Work':
      return 'work';
    default:
      return 'truth';
  }
}

async function loadDealTrustRefs(supabase: S, orgId: string, dealIds: string[]) {
  if (dealIds.length === 0) return [] as DealTrustRef[];
  const { data } = await supabase
    .from('chain_of_trust_records')
    .select('id, entity_id, current_layer, completion_percentage')
    .eq('org_id', orgId)
    .eq('entity_type', 'deal')
    .in('entity_id', dealIds);
  return (data ?? []).map((r) => ({
    dealId: r.entity_id as string,
    recordId: r.id as string,
    currentLayer: (r.current_layer as string) ?? 'Proof of Truth',
    currentLayerKey: layerShortKey(r.current_layer as string | null),
    completionPercentage: Math.round(Number(r.completion_percentage ?? 0))
  }));
}

export interface InvestmentFirmData {
  kpis: {
    pipelineValue: number;
    activeDeals: number;
    capitalDeployed: number;
    sourcingThisMonth: number;
  };
  deals: {
    id: string;
    name: string;
    stage: string;
    amount: number | null;
    status: string | null;
  }[];
  capitalProviders: { id: string; name: string }[];
  partnerships: { id: string; counterparty: string; stage: string | null }[];
  dealTrustRefs: DealTrustRef[];
}

export async function getInvestmentFirmDashboardData(
  supabase: S,
  orgId: string
): Promise<DashboardLoad<InvestmentFirmData>> {
  try {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [
      { data: deals, error: dErr },
      { data: alloc, error: aErr },
      { data: cps },
      { data: parts }
    ] = await Promise.all([
      supabase
        .from('deals')
        .select('id, name, stage, amount, status, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('allocations').select('amount, status').eq('org_id', orgId),
      supabase.from('capital_providers').select('id, name').eq('org_id', orgId).limit(6),
      supabase.from('partnerships').select('id, counterparty, stage').eq('org_id', orgId).limit(6)
    ]);
    if (dErr) return fail(dErr.message);
    if (aErr) return fail(aErr.message);

    const activeDeals = (deals ?? []).filter(
      (d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'passed'
    ).length;
    const pipelineValue = (deals ?? []).reduce((s, d) => s + (d.amount ?? 0), 0);
    const capitalDeployed = (alloc ?? [])
      .filter((a) => a.status === 'accepted' || a.status === 'funded')
      .reduce((s, a) => s + (a.amount ?? 0), 0);
    const sourcingThisMonth = (deals ?? []).filter((d) => (d.created_at ?? '') >= since).length;

    const data: InvestmentFirmData = {
      kpis: { pipelineValue, activeDeals, capitalDeployed, sourcingThisMonth },
      deals: (deals ?? []).slice(0, 6),
      capitalProviders: cps ?? [],
      partnerships: parts ?? [],
      dealTrustRefs: await loadDealTrustRefs(
        supabase,
        orgId,
        (deals ?? []).map((d) => d.id)
      )
    };
    const empty = (deals ?? []).length === 0 && (alloc ?? []).length === 0;
    return ok(data, empty);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to load investment-firm dashboard.');
  }
}

/* ---------- service_provider --------------------------------------------- */

export interface ServiceProviderData {
  kpis: {
    inboundActive: number;
    closedThisMonth: number;
    idealClientMatches: number;
    demandSignalsToday: number;
  };
  engagements: {
    id: string;
    name: string;
    stage: string;
    amount: number | null;
    status: string | null;
  }[];
  idealClients: { id: string; full_name: string; company: string | null }[];
  demandSignals: { id: string; subject: string | null; type: string | null; occurred_at: string }[];
}

export async function getServiceProviderDashboardData(
  supabase: S,
  orgId: string
): Promise<DashboardLoad<ServiceProviderData>> {
  try {
    const sinceMonth = new Date(Date.now() - 30 * 86400_000).toISOString();
    const sinceDay = new Date(Date.now() - 86400_000).toISOString();
    const [{ data: engagements, error: eErr }, { data: clients }, { data: signals }] =
      await Promise.all([
        supabase
          .from('deals')
          .select('id, name, stage, amount, status, created_at')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('contacts').select('id, full_name, company').eq('org_id', orgId).limit(6),
        supabase
          .from('interactions')
          .select('id, subject, type, occurred_at')
          .eq('org_id', orgId)
          .gte('occurred_at', sinceDay)
          .order('occurred_at', { ascending: false })
          .limit(8)
      ]);
    if (eErr) return fail(eErr.message);

    const inboundActive = (engagements ?? []).filter(
      (e) => e.status !== 'won' && e.status !== 'lost' && e.status !== 'closed'
    ).length;
    const closedThisMonth = (engagements ?? []).filter(
      (e) => (e.status === 'won' || e.stage === 'closed') && (e.created_at ?? '') >= sinceMonth
    ).length;
    const data: ServiceProviderData = {
      kpis: {
        inboundActive,
        closedThisMonth,
        idealClientMatches: (clients ?? []).length,
        demandSignalsToday: (signals ?? []).length
      },
      engagements: (engagements ?? []).slice(0, 6),
      idealClients: (clients ?? []).map((c) => ({
        id: c.id,
        full_name: c.full_name ?? 'Contact',
        company: c.company
      })),
      demandSignals: signals ?? []
    };
    const empty = (engagements ?? []).length === 0 && (clients ?? []).length === 0;
    return ok(data, empty);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to load service-provider dashboard.');
  }
}

/* ---------- startup ------------------------------------------------------ */

export interface StartupData {
  raise: {
    targetAmount: number;
    raisedAmount: number;
    progressPct: number;
    activeDealName: string | null;
  };
  warmIntros: { id: string; counterparty: string; status: string; strength: number | null }[];
  investorTargets: { id: string; name: string }[];
  materials: {
    completed: number;
    total: number;
    tasks: { id: string; title: string; status: string }[];
  };
}

export async function getStartupDashboardData(
  supabase: S,
  orgId: string,
  userId: string
): Promise<DashboardLoad<StartupData>> {
  try {
    const [
      { data: deals, error: dErr },
      { data: allocs },
      { data: intros },
      { data: investors },
      { data: tasks }
    ] = await Promise.all([
      supabase
        .from('deals')
        .select('id, name, amount, status')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('allocations').select('amount, status').eq('org_id', orgId),
      supabase
        .from('warm_introductions')
        .select('id, status, strength, target_contact_id, contacts:target_contact_id (full_name)')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(6),
      supabase.from('capital_providers').select('id, name').eq('org_id', orgId).limit(6),
      supabase
        .from('tasks')
        .select('id, title, status')
        .eq('org_id', orgId)
        .eq('assignee_id', userId)
        .limit(8)
    ]);
    if (dErr) return fail(dErr.message);

    const activeDeal = (deals ?? [])[0] ?? null;
    const target = activeDeal?.amount ?? 0;
    const raised = (allocs ?? [])
      .filter((a) => a.status === 'accepted' || a.status === 'funded')
      .reduce((s, a) => s + (a.amount ?? 0), 0);
    const progressPct = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;

    const warmIntros = (intros ?? []).map((i) => ({
      id: i.id,
      counterparty:
        (i as { contacts?: { full_name?: string | null } }).contacts?.full_name ?? 'Contact',
      status: i.status,
      strength: i.strength
    }));

    const taskList = tasks ?? [];
    const completed = taskList.filter((t) => t.status === 'done').length;
    const data: StartupData = {
      raise: {
        targetAmount: target,
        raisedAmount: raised,
        progressPct,
        activeDealName: activeDeal?.name ?? null
      },
      warmIntros,
      investorTargets: investors ?? [],
      materials: { completed, total: taskList.length, tasks: taskList.slice(0, 5) }
    };
    const empty =
      (deals ?? []).length === 0 &&
      warmIntros.length === 0 &&
      (investors ?? []).length === 0 &&
      taskList.length === 0;
    return ok(data, empty);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to load startup dashboard.');
  }
}

/* ---------- student ------------------------------------------------------ */

export interface StudentData {
  learningTasks: { id: string; title: string; status: string }[];
  curatedOpportunities: { id: string; rationale: string; score: number | null }[];
  networkContacts: { id: string; full_name: string; company: string | null }[];
  brainsKnown: number;
}

export async function getStudentDashboardData(
  supabase: S,
  orgId: string,
  userId: string
): Promise<DashboardLoad<StudentData>> {
  try {
    const [
      { data: tasks, error: tErr },
      { data: synergies },
      { data: contacts },
      { count: brainsCount }
    ] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, status')
        .eq('org_id', orgId)
        .eq('assignee_id', userId)
        .limit(8),
      supabase
        .from('synergy_opportunities')
        .select('id, rationale, score')
        .eq('org_id', orgId)
        .limit(5),
      supabase.from('contacts').select('id, full_name, company').eq('org_id', orgId).limit(5),
      supabase.from('ai_brains').select('id', { count: 'exact', head: true })
    ]);
    if (tErr) return fail(tErr.message);

    const data: StudentData = {
      learningTasks: tasks ?? [],
      curatedOpportunities: (synergies ?? []).map((o) => ({
        id: o.id,
        rationale: o.rationale ?? 'Curated opportunity',
        score: o.score
      })),
      networkContacts: (contacts ?? []).map((c) => ({
        id: c.id,
        full_name: c.full_name ?? 'Contact',
        company: c.company
      })),
      brainsKnown: brainsCount ?? 0
    };
    const empty =
      (tasks ?? []).length === 0 && (contacts ?? []).length === 0 && (synergies ?? []).length === 0;
    return ok(data, empty);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to load student dashboard.');
  }
}

/* ---------- individual_investor ------------------------------------------ */

export interface IndividualInvestorData {
  kpis: {
    activeDeals: number;
    allocationsAmount: number;
    syndicateActivity: number;
    watchlistCount: number;
  };
  deals: {
    id: string;
    name: string;
    stage: string;
    amount: number | null;
    status: string | null;
  }[];
  allocations: { id: string; amount: number | null; status: string | null; dealName: string }[];
  watchlist: { id: string; rationale: string; score: number | null }[];
  syndicateContacts: { id: string; full_name: string; company: string | null }[];
  dealTrustRefs: DealTrustRef[];
}

export async function getIndividualInvestorDashboardData(
  supabase: S,
  orgId: string
): Promise<DashboardLoad<IndividualInvestorData>> {
  try {
    const [
      { data: deals, error: dErr },
      { data: allocs },
      { data: synergies },
      { data: contacts }
    ] = await Promise.all([
      supabase
        .from('deals')
        .select('id, name, stage, amount, status, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('allocations')
        .select('id, amount, status, deal_id, deals:deal_id (name)')
        .eq('org_id', orgId)
        .limit(8),
      supabase
        .from('synergy_opportunities')
        .select('id, rationale, score')
        .eq('org_id', orgId)
        .limit(5),
      supabase.from('contacts').select('id, full_name, company').eq('org_id', orgId).limit(5)
    ]);
    if (dErr) return fail(dErr.message);

    const activeDeals = (deals ?? []).filter(
      (d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'passed'
    ).length;
    const allocationsAmount = (allocs ?? [])
      .filter((a) => a.status === 'accepted' || a.status === 'funded')
      .reduce((s, a) => s + (a.amount ?? 0), 0);

    const data: IndividualInvestorData = {
      kpis: {
        activeDeals,
        allocationsAmount,
        syndicateActivity: (contacts ?? []).length,
        watchlistCount: (synergies ?? []).length
      },
      deals: (deals ?? []).slice(0, 6),
      allocations: (allocs ?? []).map((a) => ({
        id: a.id,
        amount: a.amount,
        status: a.status,
        dealName: (a as { deals?: { name?: string | null } }).deals?.name ?? 'Deal'
      })),
      watchlist: (synergies ?? []).map((o) => ({
        id: o.id,
        rationale: o.rationale ?? 'Watchlist opportunity',
        score: o.score
      })),
      syndicateContacts: (contacts ?? []).map((c) => ({
        id: c.id,
        full_name: c.full_name ?? 'Contact',
        company: c.company
      })),
      dealTrustRefs: await loadDealTrustRefs(
        supabase,
        orgId,
        (deals ?? []).map((d) => d.id)
      )
    };
    const empty = (deals ?? []).length === 0 && (allocs ?? []).length === 0;
    return ok(data, empty);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Failed to load individual-investor dashboard.');
  }
}

/* ---------- entry point used by the page router ------------------------- */

/**
 * Resolve the supabase client + identity once for the page router so each
 * loader can be called without redundant `createClient()` overhead.
 */
export async function getDashboardContext() {
  const supabase = await createClient();
  const user = await getAuthUser();
  return { supabase, userId: user?.id ?? null };
}
