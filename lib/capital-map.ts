// lib/capital-map.ts
// The Capital Map — the intelligence layer over your network (inspired by
// Affinity, rebuilt as native intelligence). It reads the first-party tables —
// investors, commitments, relationships, the active thesis — and turns them
// into the four answers an operator actually wants:
//
//   1. Temperature — cold / warm / active / committed (relationship scoring)
//   2. Thesis fit  — does this LP match our mandate, check size, geography?
//   3. Warm intro  — "who can introduce me to this investor?" (path through the
//                     relationship graph)
//   4. Next action — the recommended move, each tagged with its gate tier
//
// Pure computation over an RLS-scoped client; tenancy is enforced by RLS so we
// never filter by organization_id here. The graph traversal reuses the same
// polymorphic node convention as lib/graph.ts (`${entity_type}:${id}`).
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Investor,
  InvestmentThesis,
} from "@/lib/supabase/database.types";
import type { ActionKind, GateTier } from "@/lib/gates";
import { tierForAction } from "@/lib/gates";
import {
  ENGAGEMENT_RELATION,
  engagementBoost,
  floorTemperatureByEngagement,
} from "@/lib/engagement";

type Client = SupabaseClient<Database>;

export type Temperature = "cold" | "warm" | "active" | "committed";

export interface ThesisFit {
  // 0..100 — how well this investor matches the active thesis.
  score: number;
  reasons: string[];
}

export interface IntroPath {
  // Readable hops from a person/entity you control to the target investor,
  // e.g. ["You", "Jane Partner", "Acme Family Office"]. The introducer is the
  // node just before the target.
  hops: string[];
  introducer: string;
}

export interface NextAction {
  action: ActionKind;
  label: string;
  tier: GateTier;
  rationale: string;
}

export interface CapitalMapEntry {
  investor: Investor;
  temperature: Temperature;
  // 0..100 sort key combining temperature and thesis fit.
  warmth: number;
  thesisFit: ThesisFit | null;
  introPath: IntroPath | null;
  nextActions: NextAction[];
  committedAmount: number;
}

const TEMPERATURE_WEIGHT: Record<Temperature, number> = {
  cold: 10,
  warm: 40,
  active: 70,
  committed: 100,
};

// Map the lightweight investors.pipeline_stage free-text into a temperature.
// Unknown stages fall back to cold — the conservative read.
export function stageToTemperature(stage: string): Temperature {
  const s = stage.toLowerCase();
  if (/(committed|closed|funded|signed)/.test(s)) return "committed";
  if (/(soft.?circle|diligence|meeting|term|negotiat)/.test(s)) return "active";
  if (/(contacted|engaged|replied|warm|intro)/.test(s)) return "warm";
  return "cold";
}

// --- Thesis fit -------------------------------------------------------------
// Score an investor against the active thesis from the signals both records
// actually carry: check-size overlap, geography, and investor type.
export function scoreThesisFit(investor: Investor, thesis: InvestmentThesis | null): ThesisFit | null {
  if (!thesis) return null;
  const reasons: string[] = [];
  let score = 0;

  // Check-size overlap (up to 45). The investor can write a check inside the
  // thesis band if their max reaches the thesis min and their min stays under
  // the thesis max.
  const invMin = investor.typical_check_min;
  const invMax = investor.typical_check_max;
  const thMin = thesis.check_size_min;
  const thMax = thesis.check_size_max;
  if (invMin != null || invMax != null) {
    const lo = invMin ?? 0;
    const hi = invMax ?? Number.POSITIVE_INFINITY;
    const tLo = thMin ?? 0;
    const tHi = thMax ?? Number.POSITIVE_INFINITY;
    const overlaps = hi >= tLo && lo <= tHi;
    if (overlaps) {
      score += 45;
      reasons.push("Check size fits the mandate band.");
    } else {
      reasons.push("Check size sits outside the mandate band.");
    }
  }

  // Geography (up to 30). Investor jurisdiction named in the thesis geographies.
  if (investor.jurisdiction && thesis.geographies.length) {
    const j = investor.jurisdiction.toLowerCase();
    const match = thesis.geographies.some(
      (g) => g.toLowerCase().includes(j) || j.includes(g.toLowerCase()),
    );
    if (match) {
      score += 30;
      reasons.push(`Based in a target geography (${investor.jurisdiction}).`);
    }
  }

  // Investor type (up to 25). Institutional allocators that anchor funds score
  // highest; "other" gets nothing.
  const typeScore: Record<string, number> = {
    institution: 25,
    fund_of_funds: 25,
    family_office: 20,
    lp: 18,
    co_gp: 12,
    bank: 10,
    lender: 8,
    other: 0,
  };
  const ts = typeScore[investor.investor_type] ?? 5;
  if (ts > 0) {
    score += ts;
    reasons.push(`${humanizeType(investor.investor_type)} — a fit for this raise.`);
  }

  return { score: Math.min(100, Math.round(score)), reasons };
}

function humanizeType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Next actions -----------------------------------------------------------
// The recommended move per temperature. Each carries its gate tier so the UI
// can badge it honestly (Internal / External / Capital-binding).
export function nextActionsFor(
  temperature: Temperature,
  hasIntroPath: boolean,
): NextAction[] {
  const a = (action: ActionKind, label: string, rationale: string): NextAction => ({
    action,
    label,
    tier: tierForAction(action),
    rationale,
  });

  switch (temperature) {
    case "committed":
      return [
        a("distribute_report", "Send LP update", "Keep a committed LP warm with progress."),
        a("draft_memo", "Draft next update", "Earn prepares the narrative for review."),
      ];
    case "active":
      return [
        a("send_diligence_request", "Send diligence pack", "Move an engaged LP toward a soft circle."),
        a("draft_message", "Draft follow-up", "Earn drafts a tailored next-step note."),
      ];
    case "warm":
      return [
        a("send_outreach", "Send outreach", "Advance a warm contact to a first meeting."),
        a("draft_message", "Draft outreach", "Earn drafts it; you send when ready."),
      ];
    case "cold":
    default:
      return hasIntroPath
        ? [
            a("send_intro_request", "Request warm intro", "Reach this LP through a shared connection."),
            a("research", "Research & qualify", "Earn builds a profile before you reach out."),
          ]
        : [
            a("research", "Research & qualify", "Earn builds a profile before you reach out."),
            a("draft_message", "Draft cold outreach", "Earn drafts a first-touch message."),
          ];
  }
}

// --- Warm-intro pathfinding -------------------------------------------------
// Breadth-first search over the relationship graph for the shortest path from
// any node the operator controls (the org + its principals) to a target
// investor. Edges are treated as undirected — an introduction can travel either
// way along a known relationship.
export type Adjacency = Map<string, Set<string>>;

function polyId(type: string, id: string): string {
  return `${type}:${id}`;
}

export function findIntroPath(
  targetInvestorId: string,
  selfNodes: string[],
  adjacency: Adjacency,
  labels: Map<string, string>,
): IntroPath | null {
  const target = polyId("investor", targetInvestorId);
  if (!adjacency.has(target)) return null;

  // Multi-source BFS from every self node at once.
  const queue: string[] = [];
  const prev = new Map<string, string | null>();
  for (const s of selfNodes) {
    if (adjacency.has(s)) {
      queue.push(s);
      prev.set(s, null);
    }
  }
  if (!queue.length) return null;

  let found = false;
  while (queue.length) {
    const node = queue.shift()!;
    if (node === target) {
      found = true;
      break;
    }
    for (const next of adjacency.get(node) ?? []) {
      if (!prev.has(next)) {
        prev.set(next, node);
        queue.push(next);
      }
    }
  }
  if (!found) return null;

  // Reconstruct the path target → self, then reverse.
  const chain: string[] = [];
  let cursor: string | null = target;
  while (cursor != null) {
    chain.unshift(cursor);
    cursor = prev.get(cursor) ?? null;
  }
  // A self → target path of length 1 means a direct relationship (no intro
  // needed); still useful to show. Label the first hop as "You".
  const hops = chain.map((id, i) =>
    i === 0 ? "You" : labels.get(id) || humanizeType(id.split(":")[0]),
  );
  const introducer = hops.length > 1 ? hops[hops.length - 2] : "You";
  return { hops, introducer };
}

// --- Assembly ---------------------------------------------------------------
/**
 * Build the Capital Map for the active org. Returns one entry per investor,
 * sorted hottest-first (committed and high-fit at the top).
 */
export async function buildCapitalMap(supabase: Client): Promise<CapitalMapEntry[]> {
  const [investorsRes, thesisRes, commitmentsRes, relationshipsRes, membersRes] =
    await Promise.all([
      supabase.from("investors").select("*").is("archived_at", null).limit(500),
      supabase
        .from("investment_theses")
        .select("*")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase.from("commitments").select("investor_id, committed_amount").limit(1000),
      supabase
        .from("relationships")
        .select("from_entity_type, from_entity_id, to_entity_type, to_entity_id, relation, metadata")
        .eq("graph", "relationship")
        .limit(2000),
      supabase.from("organization_members").select("principal_id").limit(200),
    ]);

  const investors = (investorsRes.data ?? []) as Investor[];
  const thesis = (thesisRes.data?.[0] as InvestmentThesis | undefined) ?? null;
  const commitments = commitmentsRes.data ?? [];
  const relRows = relationshipsRes.data ?? [];
  const memberIds = (membersRes.data ?? []).map((m) => m.principal_id);

  // Committed amount per investor (the strongest temperature signal).
  const committedByInvestor = new Map<string, number>();
  for (const c of commitments) {
    committedByInvestor.set(
      c.investor_id,
      (committedByInvestor.get(c.investor_id) ?? 0) + Number(c.committed_amount ?? 0),
    );
  }

  // Undirected adjacency + a label map for readable intro paths.
  const adjacency: Adjacency = new Map();
  const labels = new Map<string, string>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const r of relRows) {
    link(
      polyId(r.from_entity_type, r.from_entity_id),
      polyId(r.to_entity_type, r.to_entity_id),
    );
  }
  for (const inv of investors) labels.set(polyId("investor", inv.id), inv.name);

  // Engagement feedback: "engaged" edges the operator's actions wrote back onto
  // the graph. Each carries a running count in its metadata; we take the highest
  // count per investor and treat the org as a node we control so an engaged LP
  // reads as directly reachable.
  const engagementByInvestor = new Map<string, number>();
  const orgSelfNodes = new Set<string>();
  for (const r of relRows) {
    if (r.relation === ENGAGEMENT_RELATION && r.to_entity_type === "investor") {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const count = typeof meta.count === "number" ? meta.count : 1;
      engagementByInvestor.set(
        r.to_entity_id,
        Math.max(engagementByInvestor.get(r.to_entity_id) ?? 0, count),
      );
      if (r.from_entity_type === "organization") {
        orgSelfNodes.add(polyId("organization", r.from_entity_id));
      }
    }
  }

  // Resolve principal names for the intro hops (best-effort; RLS-scoped).
  if (memberIds.length) {
    const { data: principals } = await supabase
      .from("principals")
      .select("id, full_name")
      .in("id", memberIds);
    for (const p of principals ?? []) {
      labels.set(polyId("principal", p.id), p.full_name || "Teammate");
    }
  }

  // Nodes the operator controls: the team's principals plus the org itself
  // (which owns the engagement edges).
  const selfNodes = [...memberIds.map((id) => polyId("principal", id)), ...orgSelfNodes];

  const entries: CapitalMapEntry[] = investors.map((investor) => {
    const committedAmount = committedByInvestor.get(investor.id) ?? 0;
    const engagementCount = engagementByInvestor.get(investor.id) ?? 0;
    const baseTemperature: Temperature =
      committedAmount > 0 ? "committed" : stageToTemperature(investor.pipeline_stage);
    // Engagement can only lift a relationship, never cool it.
    const temperature = floorTemperatureByEngagement(baseTemperature, engagementCount);
    const thesisFit = scoreThesisFit(investor, thesis);
    const introPath = findIntroPath(investor.id, selfNodes, adjacency, labels);
    const nextActions = nextActionsFor(temperature, !!introPath);

    // Warmth blends temperature (70%) and thesis fit (30%), then adds the
    // compounding engagement boost — so a worked LP climbs the list over time.
    const fit = thesisFit?.score ?? 0;
    const warmth = Math.min(
      100,
      Math.round(TEMPERATURE_WEIGHT[temperature] * 0.7 + fit * 0.3) + engagementBoost(engagementCount),
    );

    return {
      investor,
      temperature,
      warmth,
      thesisFit,
      introPath,
      nextActions,
      committedAmount,
    };
  });

  entries.sort((a, b) => b.warmth - a.warmth);
  return entries;
}
