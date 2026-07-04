import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildGraph, isGraphKind, GRAPH_KINDS } from "@/lib/graph";

// GET /api/graph/[graph] — return the requested graph as { nodes, edges } for
// the active org. [graph] is one of relationship | deal | capital. Org-scoped
// via requireOrgContext() + RLS on the server client.
export async function GET(_request: Request, props: { params: Promise<{ graph: string }> }) {
  const params = await props.params;
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isGraphKind(params.graph)) {
    return NextResponse.json(
      { error: `Invalid graph. Expected one of: ${GRAPH_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const data = await buildGraph(supabase, params.graph);
  return NextResponse.json(data);
}
