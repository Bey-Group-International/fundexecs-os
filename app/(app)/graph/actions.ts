"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

// Server actions backing the Delete / Clear all controls on the three-graph
// explorer. Graph nodes are namespaced "<entity_type>:<uuid>" (see lib/graph's
// polyId). Deleting a node hard-deletes the underlying domain entity and any
// relationship edges that reference it. This is destructive and cascades: e.g.
// deleting a fund removes its commitments (on delete cascade), so it disappears
// from the Capital and Deal graphs too.

type EntityTable = keyof Database["public"]["Tables"];

// entity_type (as encoded in a node id) → concrete table. "organization" is
// intentionally excluded: an organization node is the tenant itself, and
// deleting it would cascade the entire workspace away.
const ENTITY_TABLE: Record<string, EntityTable> = {
  investor: "investors",
  deal: "deals",
  fund: "funds",
  asset: "assets",
  principal: "principals",
  contact: "network_contacts",
};

type Result = { ok: boolean; error?: string };

// Split "fund:<uuid>" → ["fund", "<uuid>"]. entity_type never contains a colon
// and the id is a bare uuid, so the first colon is the delimiter.
function parseNodeId(nodeId: string): { type: string; id: string } | null {
  const sep = nodeId.indexOf(":");
  if (sep <= 0) return null;
  const type = nodeId.slice(0, sep);
  const id = nodeId.slice(sep + 1);
  if (!id) return null;
  return { type, id };
}

async function deleteOne(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  orgId: string,
  nodeId: string,
): Promise<Result> {
  const parsed = parseNodeId(nodeId);
  if (!parsed) return { ok: false, error: "Unknown node." };

  const table = ENTITY_TABLE[parsed.type];
  if (!table) {
    return { ok: false, error: `${parsed.type.replace(/_/g, " ")} nodes can't be deleted.` };
  }

  // Remove polymorphic relationship edges on either side of this entity first,
  // so the graph doesn't keep dangling edges (they aren't real FKs).
  await supabase
    .from("relationships")
    .delete()
    .eq("organization_id", orgId)
    .eq("from_entity_type", parsed.type)
    .eq("from_entity_id", parsed.id);
  await supabase
    .from("relationships")
    .delete()
    .eq("organization_id", orgId)
    .eq("to_entity_type", parsed.type)
    .eq("to_entity_id", parsed.id);

  // Supabase's generated types collapse the filter columns of a dynamic (union)
  // table name to `never`. Cast the delete builder to a minimal chainable shape
  // so the org-scoped delete stays sound at this one dynamic call site.
  const entityDelete = supabase.from(table).delete() as unknown as {
    eq: (
      col: string,
      val: string,
    ) => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
  };
  const { error } = await entityDelete.eq("id", parsed.id).eq("organization_id", orgId);
  if (error) return { ok: false, error: "Could not delete node." };

  return { ok: true };
}

/**
 * Permanently delete a single graph node — its underlying domain entity and the
 * relationship edges that touch it. Org-scoped and defensive.
 */
export async function deleteGraphNode(nodeId: string): Promise<Result> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

    const supabase = await createServerClient();
    const res = await deleteOne(supabase, ctx.orgId, nodeId);
    if (res.ok) revalidatePath("/graph");
    return res;
  } catch {
    return { ok: false, error: "Could not delete node." };
  }
}

/**
 * Permanently clear a graph: delete the underlying entity (and edges) for every
 * node id passed in. Organization nodes are skipped (the tenant is never
 * deletable). Returns how many nodes were removed. Org-scoped and defensive.
 */
export async function clearGraph(
  nodeIds: string[],
): Promise<{ ok: boolean; error?: string; deleted?: number }> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { ok: false, error: "Not signed in." };
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return { ok: true, deleted: 0 };

    const supabase = await createServerClient();
    let deleted = 0;
    for (const nodeId of nodeIds) {
      const parsed = parseNodeId(nodeId);
      // Silently skip nodes we won't delete (e.g. organization) so one
      // non-deletable node doesn't abort clearing the rest.
      if (!parsed || !ENTITY_TABLE[parsed.type]) continue;
      const res = await deleteOne(supabase, ctx.orgId, nodeId);
      if (res.ok) deleted += 1;
    }

    revalidatePath("/graph");
    return { ok: true, deleted };
  } catch {
    return { ok: false, error: "Could not clear graph." };
  }
}
