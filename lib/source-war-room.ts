// Source-hub investor (LP) war room: everything about one LP in a single place —
// who they are and how warm they are, the thesis fit against the firm's active
// mandate, the commitments they've made (per fund, with called/distributed
// progress), the capital flows tied to them, the next best moves, and the warm
// intro path through the relationship graph. This is the drill-down behind every
// LP chip in the Source command center, mirroring the Run-hub deal war room.
import { createServerClient } from "@/lib/supabase/server";
import {
  stageToTemperature,
  scoreThesisFit,
  nextActionsFor,
  findIntroPath,
  type Temperature,
  type ThesisFit,
  type IntroPath,
  type NextAction,
  type Adjacency,
} from "@/lib/capital-map";
import type {
  Investor,
  Commitment,
  CapitalEvent,
  Fund,
  InvestmentThesis,
  Relationship,
} from "@/lib/supabase/database.types";

// A commitment paired with the fund it was made against, so the UI can name the
// vehicle without a second lookup.
export interface CommitmentWithFund {
  commitment: Commitment;
  fund: Fund | null;
}

// Rolled-up commitment economics across every fund this LP has committed to.
export interface CommitmentTotals {
  committedTotal: number;
  calledTotal: number;
  distributedTotal: number;
}

export interface InvestorWarRoom {
  investor: Investor;
  temperature: Temperature;
  thesisFit: ThesisFit | null;
  commitments: CommitmentWithFund[];
  committedTotal: number;
  calledTotal: number;
  distributedTotal: number;
  capitalEvents: CapitalEvent[];
  nextActions: NextAction[];
  introPath: IntroPath | null;
  relationships: Relationship[];
}

// --- Pure helpers (unit-tested in source-war-room.test.ts) ------------------

/**
 * Sum a set of commitments into committed / called / distributed totals. Pure
 * over already-fetched rows — coerces nullable numerics defensively so a missing
 * value never poisons the total with NaN.
 */
export function sumCommitments(commitments: Commitment[]): CommitmentTotals {
  return commitments.reduce<CommitmentTotals>(
    (acc, c) => ({
      committedTotal: acc.committedTotal + Number(c.committed_amount ?? 0),
      calledTotal: acc.calledTotal + Number(c.called_amount ?? 0),
      distributedTotal: acc.distributedTotal + Number(c.distributed_amount ?? 0),
    }),
    { committedTotal: 0, calledTotal: 0, distributedTotal: 0 },
  );
}

/**
 * The LP's temperature: a live commitment is the strongest signal (committed),
 * otherwise fall back to reading the lightweight pipeline_stage. Mirrors the
 * Capital Map's per-investor rule so the war room and the pipeline never
 * disagree.
 */
export function investorTemperature(investor: Investor, committedTotal: number): Temperature {
  return committedTotal > 0 ? "committed" : stageToTemperature(investor.pipeline_stage);
}

/**
 * Format an amount as a compact currency string (e.g. $1.2M, $850K, $2.4B).
 * Used across the war-room panels for committed/called/distributed figures.
 */
export function formatCompactCurrency(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${trim(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// Drop a trailing ".0" so whole numbers read cleanly ($2M, not $2.0M).
function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

// --- Assembly ---------------------------------------------------------------

/**
 * Assemble the full war room for one LP. Fetches the investor scoped to the org
 * (returns null if absent or not theirs), then in parallel: the org's active
 * thesis (for the fit score), this LP's commitments, the funds those
 * commitments are against, the capital events tied to this LP, and every
 * relationship edge touching them. Tenancy is enforced both by RLS and by an
 * explicit organization_id filter.
 */
export async function getInvestorWarRoom(
  orgId: string,
  investorId: string,
): Promise<InvestorWarRoom | null> {
  const supabase = createServerClient();

  const { data: investorRow } = await supabase
    .from("investors")
    .select("*")
    .eq("id", investorId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const investor = investorRow as Investor | null;
  if (!investor) return null;

  const node = `investor:${investorId}`;

  const [thesisRes, commitmentsRes, eventsRes, fromRelRes, toRelRes, membersRes] =
    await Promise.all([
      supabase
        .from("investment_theses")
        .select("*")
        .eq("organization_id", orgId)
        .order("is_active", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("commitments")
        .select("*")
        .eq("organization_id", orgId)
        .eq("investor_id", investorId)
        .order("committed_at", { ascending: false }),
      supabase
        .from("capital_events")
        .select("*")
        .eq("organization_id", orgId)
        .eq("investor_id", investorId)
        .is("archived_at", null)
        .order("effective_date", { ascending: false })
        .limit(200),
      supabase
        .from("relationships")
        .select("*")
        .eq("organization_id", orgId)
        .eq("graph", "relationship")
        .eq("from_entity_type", "investor")
        .eq("from_entity_id", investorId)
        .limit(500),
      supabase
        .from("relationships")
        .select("*")
        .eq("organization_id", orgId)
        .eq("graph", "relationship")
        .eq("to_entity_type", "investor")
        .eq("to_entity_id", investorId)
        .limit(500),
      supabase.from("organization_members").select("principal_id").eq("organization_id", orgId).limit(200),
    ]);

  const thesis = (thesisRes.data as InvestmentThesis | null) ?? null;
  const commitments = (commitmentsRes.data ?? []) as Commitment[];
  const capitalEvents = (eventsRes.data ?? []) as CapitalEvent[];
  const relationships = [
    ...((fromRelRes.data ?? []) as Relationship[]),
    ...((toRelRes.data ?? []) as Relationship[]),
  ];
  const memberIds = (membersRes.data ?? []).map((m) => m.principal_id as string);

  // Resolve the funds referenced by the commitments in one round-trip.
  const fundIds = [...new Set(commitments.map((c) => c.fund_id))];
  let fundsById = new Map<string, Fund>();
  if (fundIds.length) {
    const { data: fundRows } = await supabase
      .from("funds")
      .select("*")
      .eq("organization_id", orgId)
      .in("id", fundIds);
    fundsById = new Map(((fundRows ?? []) as Fund[]).map((f) => [f.id, f]));
  }

  const commitmentsWithFund: CommitmentWithFund[] = commitments.map((commitment) => ({
    commitment,
    fund: fundsById.get(commitment.fund_id) ?? null,
  }));

  const { committedTotal, calledTotal, distributedTotal } = sumCommitments(commitments);

  const temperature = investorTemperature(investor, committedTotal);
  const thesisFit = scoreThesisFit(investor, thesis);

  // Warm-intro path: build an undirected adjacency from this LP's edges and walk
  // it from any principal the firm controls toward the LP.
  const introPath = buildIntroPath(investorId, relationships, memberIds, investor.name);
  const nextActions = nextActionsFor(temperature, !!introPath);

  return {
    investor,
    temperature,
    thesisFit,
    commitments: commitmentsWithFund,
    committedTotal,
    calledTotal,
    distributedTotal,
    capitalEvents,
    nextActions,
    introPath,
    relationships,
  };
}

// Construct the warm-intro path for one LP from the edges that touch them.
// Kept thin: the graph traversal itself lives in capital-map's findIntroPath.
function buildIntroPath(
  investorId: string,
  relationships: Relationship[],
  memberIds: string[],
  investorName: string,
): IntroPath | null {
  if (!relationships.length || !memberIds.length) return null;

  const adjacency: Adjacency = new Map();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const r of relationships) {
    link(`${r.from_entity_type}:${r.from_entity_id}`, `${r.to_entity_type}:${r.to_entity_id}`);
  }

  const labels = new Map<string, string>([[`investor:${investorId}`, investorName]]);
  const selfNodes = memberIds.map((id) => `principal:${id}`);
  return findIntroPath(investorId, selfNodes, adjacency, labels);
}
