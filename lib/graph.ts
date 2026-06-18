// lib/graph.ts
// The three-graph query layer. Assembles {nodes, edges} for each of the three
// graphs (Relationship / Deal / Capital) from the org-scoped tables. The
// caller passes an RLS-scoped Supabase client (server or service); every query
// is implicitly tenancy-bounded by RLS, so we never filter by organization_id
// here.
//
// - Relationship graph: the polymorphic `relationships` edges (graph =
//   'relationship'), with concrete entities resolved to readable labels.
// - Deal graph: deals + the funds they sit in (deals.fund_id) + assets that
//   belong to a deal (assets.deal_id).
// - Capital graph: funds + the investors committed to them, joined through
//   `commitments` (the commitment is the edge).
//
// Shared by the /api/graph/[graph] route and the /graph visualization page so
// the API and the server-rendered page never drift.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, GraphKind } from "@/lib/supabase/database.types";

export const GRAPH_KINDS: GraphKind[] = ["relationship", "deal", "capital"];

export function isGraphKind(value: string): value is GraphKind {
  return (GRAPH_KINDS as string[]).includes(value);
}

export type GraphNode = {
  id: string;
  label: string;
  // A coarse node category — drives color/legend in the UI. For the
  // relationship graph this mirrors the polymorphic entity_type.
  type: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  relation?: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type Client = SupabaseClient<Database>;

// A small accumulator that de-dupes nodes by id while preserving the first
// (most descriptive) label seen.
class NodeSet {
  private map = new Map<string, GraphNode>();

  add(id: string, label: string, type: string): string {
    if (!this.map.has(id)) {
      this.map.set(id, { id, label, type });
    }
    return id;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  list(): GraphNode[] {
    return [...this.map.values()];
  }
}

// Polymorphic node ids for relationship edges namespace the raw uuid with its
// entity_type so two different objects can never collide on a bare uuid.
function polyId(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Relationship graph -----------------------------------------------------
async function buildRelationshipGraph(supabase: Client): Promise<GraphData> {
  const { data: edges } = await supabase
    .from("relationships")
    .select(
      "from_entity_type, from_entity_id, to_entity_type, to_entity_id, relation",
    )
    .eq("graph", "relationship")
    .limit(500);

  const rows = edges ?? [];

  // Resolve readable labels for the entities referenced by these edges. We
  // batch one query per referenced table that has a name column.
  const idsByTable = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const [t, id] of [
      [r.from_entity_type, r.from_entity_id],
      [r.to_entity_type, r.to_entity_id],
    ] as const) {
      if (!idsByTable.has(t)) idsByTable.set(t, new Set());
      idsByTable.get(t)!.add(id);
    }
  }

  // entity_type -> table name + label column. principal uses full_name.
  const RESOLVABLE: Record<
    string,
    { table: keyof Database["public"]["Tables"]; col: string }
  > = {
    investor: { table: "investors", col: "name" },
    deal: { table: "deals", col: "name" },
    fund: { table: "funds", col: "name" },
    asset: { table: "assets", col: "name" },
    organization: { table: "organizations", col: "name" },
    principal: { table: "principals", col: "full_name" },
  };

  const labels = new Map<string, string>();
  await Promise.all(
    [...idsByTable.entries()].map(async ([entityType, ids]) => {
      const resolvable = RESOLVABLE[entityType];
      if (!resolvable) return;
      const { data } = await supabase
        .from(resolvable.table)
        .select(`id, ${resolvable.col}`)
        .in("id", [...ids]);
      for (const row of (data ?? []) as unknown as Record<
        string,
        string | null
      >[]) {
        const name = row[resolvable.col];
        if (row.id) labels.set(polyId(entityType, row.id), name ?? "");
      }
    }),
  );

  const nodes = new NodeSet();
  const graphEdges: GraphEdge[] = [];
  for (const r of rows) {
    const from = polyId(r.from_entity_type, r.from_entity_id);
    const to = polyId(r.to_entity_type, r.to_entity_id);
    nodes.add(
      from,
      labels.get(from) || humanize(r.from_entity_type),
      r.from_entity_type,
    );
    nodes.add(to, labels.get(to) || humanize(r.to_entity_type), r.to_entity_type);
    graphEdges.push({ source: from, target: to, relation: r.relation });
  }

  return { nodes: nodes.list(), edges: graphEdges };
}

// --- Deal graph -------------------------------------------------------------
async function buildDealGraph(supabase: Client): Promise<GraphData> {
  const [dealsRes, fundsRes, assetsRes] = await Promise.all([
    supabase.from("deals").select("id, name, stage, fund_id").limit(500),
    supabase.from("funds").select("id, name, fund_type").limit(500),
    supabase.from("assets").select("id, name, deal_id").limit(500),
  ]);

  const deals = dealsRes.data ?? [];
  const funds = fundsRes.data ?? [];
  const assets = assetsRes.data ?? [];

  const nodes = new NodeSet();
  const edges: GraphEdge[] = [];

  for (const f of funds) {
    nodes.add(polyId("fund", f.id), f.name, "fund");
  }
  for (const d of deals) {
    const dealNode = nodes.add(polyId("deal", d.id), d.name, "deal");
    if (d.fund_id && nodes.has(polyId("fund", d.fund_id))) {
      // deal sits in fund
      edges.push({
        source: polyId("fund", d.fund_id),
        target: dealNode,
        relation: "holds",
      });
    }
  }
  for (const a of assets) {
    if (a.deal_id && nodes.has(polyId("deal", a.deal_id))) {
      nodes.add(polyId("asset", a.id), a.name, "asset");
      edges.push({
        source: polyId("deal", a.deal_id),
        target: polyId("asset", a.id),
        relation: "acquired",
      });
    }
  }

  return { nodes: nodes.list(), edges };
}

// --- Capital graph ----------------------------------------------------------
async function buildCapitalGraph(supabase: Client): Promise<GraphData> {
  const [fundsRes, investorsRes, commitmentsRes] = await Promise.all([
    supabase.from("funds").select("id, name").limit(500),
    supabase.from("investors").select("id, name, investor_type").limit(500),
    supabase
      .from("commitments")
      .select("fund_id, investor_id, committed_amount")
      .limit(1000),
  ]);

  const funds = fundsRes.data ?? [];
  const investors = investorsRes.data ?? [];
  const commitments = commitmentsRes.data ?? [];

  const nodes = new NodeSet();
  const edges: GraphEdge[] = [];

  for (const f of funds) {
    nodes.add(polyId("fund", f.id), f.name, "fund");
  }
  for (const inv of investors) {
    nodes.add(polyId("investor", inv.id), inv.name, inv.investor_type);
  }
  for (const c of commitments) {
    const fund = polyId("fund", c.fund_id);
    const investor = polyId("investor", c.investor_id);
    if (nodes.has(fund) && nodes.has(investor)) {
      edges.push({ source: investor, target: fund, relation: "committed" });
    }
  }

  return { nodes: nodes.list(), edges };
}

// Assemble the requested graph. The Supabase client is RLS-scoped, so results
// are already org-bounded.
export async function buildGraph(
  supabase: Client,
  graph: GraphKind,
): Promise<GraphData> {
  switch (graph) {
    case "relationship":
      return buildRelationshipGraph(supabase);
    case "deal":
      return buildDealGraph(supabase);
    case "capital":
      return buildCapitalGraph(supabase);
  }
}
