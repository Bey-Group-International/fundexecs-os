// POST /api/network/contacts/bulk — apply one change to many relationships.
//
// Reassigning a departing colleague's book, moving a segment to a new stage,
// tagging an import, archiving a stale batch: all of it is one operator action
// on hundreds of rows, and doing it one record at a time is how it does not get
// done at all.
//
// Two things keep this honest. The write is bounded (200 ids, one field set),
// and every affected record gets its own audit entry — a bulk reassignment is
// exactly the act a review wants itemised, not summarised.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { isContactStage } from "@/lib/network-stages";
import { recordNetworkAuditBatch } from "@/lib/network-audit";
import { invalidateRoster } from "@/lib/network-roster";

export const dynamic = "force-dynamic";

const MAX_IDS = 200;

type Payload = {
  contactIds?: string[];
  stage?: string;
  ownerId?: string | null;
  visibility?: string;
  /** Tags to add. Additive by design — a bulk action should not silently drop
   *  labels it was not told about. */
  addTags?: string[];
  archive?: boolean;
};

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-bulk`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 20) },
    );
  }

  const payload = (await req.json().catch(() => null)) as Payload | null;
  const ids = [...new Set((payload?.contactIds ?? []).filter((v): v is string => typeof v === "string"))];

  if (ids.length === 0) {
    return NextResponse.json({ error: "contactIds is required." }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Select at most ${MAX_IDS} contacts at a time.` },
      { status: 400 },
    );
  }

  const supabase = (await createServerClient()) as any;
  const patch: Record<string, unknown> = {};
  let action: "bulk_update" | "assign" | "stage_change" | "archive" = "bulk_update";

  if (payload?.stage !== undefined) {
    if (!isContactStage(payload.stage)) {
      return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
    }
    patch.stage = payload.stage;
    action = "stage_change";
  }

  if (payload?.ownerId !== undefined) {
    if (payload.ownerId === null) {
      patch.relationship_owner = null;
    } else {
      const { data: member } = await supabase
        .from("organization_members")
        .select("principal_id")
        .eq("organization_id", auth.ctx.orgId)
        .eq("principal_id", payload.ownerId)
        .maybeSingle();
      if (!member) {
        return NextResponse.json(
          { error: "That owner is not a member of this organization." },
          { status: 400 },
        );
      }
      patch.relationship_owner = payload.ownerId;
    }
    action = "assign";
  }

  if (payload?.visibility !== undefined) {
    if (payload.visibility !== "org" && payload.visibility !== "private") {
      return NextResponse.json({ error: "visibility must be 'org' or 'private'." }, { status: 400 });
    }
    patch.visibility = payload.visibility;
  }

  if (payload?.archive === true) {
    patch.archived_at = new Date().toISOString();
    action = "archive";
  }

  const addTags = (payload?.addTags ?? [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean);

  if (Object.keys(patch).length === 0 && addTags.length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  // Read first so the audit trail can name each record, and so ids the caller
  // cannot see are dropped rather than silently "updated" to zero rows.
  const { data: targets, error: readError } = await supabase
    .from("network_contacts")
    .select("id, full_name, tags, stage, relationship_owner")
    .eq("organization_id", auth.ctx.orgId)
    .in("id", ids);

  if (readError) {
    console.error("[network/bulk] read", readError);
    return NextResponse.json({ error: "Failed to load those contacts" }, { status: 500 });
  }

  const visible = (targets ?? []) as {
    id: string;
    full_name: string | null;
    tags: string[] | null;
    stage: string | null;
    relationship_owner: string | null;
  }[];

  if (visible.length === 0) {
    return NextResponse.json({ error: "None of those contacts are available to you." }, { status: 404 });
  }

  let updated = 0;

  if (addTags.length > 0) {
    // Tag unions differ per row, so these are individual writes. Everything
    // else in the patch rides along on the same update.
    for (const row of visible) {
      const merged = [...new Set([...(row.tags ?? []), ...addTags])].slice(0, 25);
      const { error } = await supabase
        .from("network_contacts")
        .update({ ...patch, tags: merged, updated_at: new Date().toISOString() })
        .eq("organization_id", auth.ctx.orgId)
        .eq("id", row.id);
      if (error) {
        console.warn("[network/bulk] row update failed", row.id, error);
        continue;
      }
      updated += 1;
    }
  } else {
    const { error, count } = await supabase
      .from("network_contacts")
      .update({ ...patch, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("organization_id", auth.ctx.orgId)
      .in(
        "id",
        visible.map((r) => r.id),
      );
    if (error) {
      console.error("[network/bulk] update", error);
      return NextResponse.json({ error: "Bulk update failed" }, { status: 500 });
    }
    updated = count ?? visible.length;
  }

  invalidateRoster(auth.ctx.orgId);

  // A stage move is part of each relationship's history, not just the log.
  if (patch.stage !== undefined) {
    const changed = visible.filter((r) => r.stage !== patch.stage);
    if (changed.length > 0) {
      const { error } = await supabase.from("network_activities").insert(
        changed.map((r) => ({
          organization_id: auth.ctx.orgId,
          contact_id: r.id,
          actor_id: auth.ctx.userId,
          activity_type: "stage_change",
          subject: `Stage changed to ${patch.stage}`,
          is_system: true,
          metadata: { from: r.stage, to: patch.stage, bulk: true },
        })),
      );
      if (error) console.warn("[network/bulk] stage timeline entries failed", error);
    }
  }

  if (patch.relationship_owner !== undefined) {
    const changed = visible.filter((r) => r.relationship_owner !== patch.relationship_owner);
    if (changed.length > 0) {
      const { error } = await supabase.from("network_activities").insert(
        changed.map((r) => ({
          organization_id: auth.ctx.orgId,
          contact_id: r.id,
          actor_id: auth.ctx.userId,
          activity_type: "owner_change",
          subject: patch.relationship_owner ? "Relationship reassigned" : "Relationship unassigned",
          is_system: true,
          metadata: { from: r.relationship_owner, to: patch.relationship_owner, bulk: true },
        })),
      );
      if (error) console.warn("[network/bulk] owner timeline entries failed", error);
    }
  }

  await recordNetworkAuditBatch(
    supabase,
    visible.map((r) => ({
      orgId: auth.ctx.orgId,
      actorId: auth.ctx.userId,
      action,
      entityId: r.id,
      entityLabel: r.full_name,
      metadata: {
        bulk: true,
        batchSize: visible.length,
        fields: [...Object.keys(patch), ...(addTags.length ? ["tags"] : [])],
      },
    })),
  );

  return NextResponse.json({
    ok: true,
    updated,
    skipped: ids.length - visible.length,
  });
}
