// GET /api/network/audit — the relationship access trail, for org admins.
//
// RLS already restricts reads to admins (network_audit_log_select calls
// is_org_admin), so a member's request comes back empty rather than forbidden.
// The explicit role check here turns that silence into an honest 403: "you
// cannot see this" is a better answer than "there is nothing here".

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { loadPrincipalNames } from "@/lib/network-contact";

export const dynamic = "force-dynamic";

const ACTIONS = [
  "view",
  "create",
  "update",
  "delete",
  "archive",
  "export",
  "merge",
  "assign",
  "stage_change",
  "bulk_update",
  "search",
];

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.ctx.role !== "owner" && auth.ctx.role !== "admin") {
    return NextResponse.json(
      { error: "The relationship audit trail is available to organization admins." },
      { status: 403 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const parsed = parseInt(sp.get("limit") ?? "100", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 100;

  const supabase = (await createServerClient()) as any;

  let query = supabase
    .from("network_audit_log")
    .select("id, actor_id, action, entity_type, entity_id, entity_label, metadata, created_at")
    .eq("organization_id", auth.ctx.orgId);

  const action = sp.get("action");
  if (action && ACTIONS.includes(action)) query = query.eq("action", action);

  const entityId = sp.get("entityId");
  if (entityId) query = query.eq("entity_id", entityId);

  const actor = sp.get("actor");
  if (actor) query = query.eq("actor_id", actor);

  const since = sp.get("since");
  if (since && !Number.isNaN(Date.parse(since))) {
    query = query.gte("created_at", new Date(since).toISOString());
  }

  const [names, { data, error }] = await Promise.all([
    loadPrincipalNames(supabase, auth.ctx.orgId),
    query.order("created_at", { ascending: false }).limit(limit),
  ]);

  if (error) {
    console.error("[network/audit]", error);
    return NextResponse.json({ error: "Failed to load the audit trail" }, { status: 500 });
  }

  return NextResponse.json({
    entries: (data ?? []).map((e: Record<string, any>) => ({
      id: e.id,
      actorId: e.actor_id ?? null,
      actorName: e.actor_id ? (names.get(String(e.actor_id)) ?? "Former member") : "System",
      action: e.action,
      entityType: e.entity_type,
      entityId: e.entity_id ?? null,
      entityLabel: e.entity_label ?? null,
      metadata: e.metadata ?? {},
      at: e.created_at,
    })),
  });
}
