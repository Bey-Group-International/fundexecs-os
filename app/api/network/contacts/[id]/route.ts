// One contact record.
//
//   GET   — the full record view: contact, timeline, tasks, possible duplicates.
//   PATCH — change relationship state (stage, owner, visibility, tags, notes,
//           next step). Stage and owner changes also write a system timeline
//           entry, so "who moved this to Diligence, and when" is answerable
//           from the record itself rather than only from the admin audit log.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { isContactStage } from "@/lib/network-stages";
import { loadContactRecord, loadPrincipalNames, mapContactRecord } from "@/lib/network-contact";
import { recordNetworkAudit, type AuditAction } from "@/lib/network-audit";
import { loadFieldDefsStrict } from "@/lib/network-field-defs.server";
import { applyCustomPatch } from "@/lib/network-fields";
import { invalidateRoster } from "@/lib/network-roster";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const CONTACT_RETURN_COLUMNS =
  "id, first_name, last_name, full_name, title, company, company_domain, email, phone, linkedin_url, avatar_url, location, capital_role, relationship_type, stage, visibility, relationship_owner, strength_score, strength_label, relevance_score, tags, notes, source, connected_on, created_at, last_activity_at, next_step_at, verified, confidence, communication_status, consent_basis, consent_at, compliance_flags, archived_at, merged_into_id, custom";

const MAX_NOTES = 20_000;
const MAX_TAGS = 25;

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = (await createServerClient()) as any;
  const view = await loadContactRecord(supabase, auth.ctx.orgId, id);
  if (!view) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-contact-update`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 60) },
    );
  }

  const { id } = await params;
  const payload = (await req.json().catch(() => null)) as {
    stage?: string;
    ownerId?: string | null;
    visibility?: string;
    tags?: string[];
    notes?: string | null;
    nextStepAt?: string | null;
    title?: string | null;
    company?: string | null;
    /** Values for this org's own columns, keyed by field_key. */
    custom?: Record<string, unknown>;
  } | null;

  if (!payload || Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;

  const { data: before } = await supabase
    .from("network_contacts")
    .select("id, full_name, stage, relationship_owner, visibility, custom")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if (payload.stage !== undefined) {
    if (!isContactStage(payload.stage)) {
      return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
    }
    patch.stage = payload.stage;
  }

  if (payload.ownerId !== undefined) {
    if (payload.ownerId === null) {
      patch.relationship_owner = null;
    } else {
      // An owner must be a member of this org. Without this check any uuid
      // could be written into the column and the relationship would be
      // assigned to nobody the team can see.
      const { data: member } = await supabase
        .from("organization_members")
        .select("principal_id")
        .eq("organization_id", auth.ctx.orgId)
        .eq("principal_id", payload.ownerId)
        .maybeSingle();
      if (!member) {
        return NextResponse.json({ error: "That owner is not a member of this organization." }, { status: 400 });
      }
      patch.relationship_owner = payload.ownerId;
    }
  }

  if (payload.visibility !== undefined) {
    if (payload.visibility !== "org" && payload.visibility !== "private") {
      return NextResponse.json({ error: "visibility must be 'org' or 'private'." }, { status: 400 });
    }
    patch.visibility = payload.visibility;
  }

  if (payload.tags !== undefined) {
    if (!Array.isArray(payload.tags)) {
      return NextResponse.json({ error: "tags must be an array." }, { status: 400 });
    }
    patch.tags = [
      ...new Set(
        payload.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().slice(0, 40))
          .filter(Boolean),
      ),
    ].slice(0, MAX_TAGS);
  }

  if (payload.notes !== undefined) {
    patch.notes = payload.notes === null ? null : String(payload.notes).slice(0, MAX_NOTES);
  }

  if (payload.nextStepAt !== undefined) {
    if (payload.nextStepAt === null) {
      patch.next_step_at = null;
    } else {
      const ms = Date.parse(payload.nextStepAt);
      if (Number.isNaN(ms)) {
        return NextResponse.json({ error: "nextStepAt must be a valid date." }, { status: 400 });
      }
      patch.next_step_at = new Date(ms).toISOString();
    }
  }

  if (payload.title !== undefined) patch.title = payload.title?.slice(0, 200) ?? null;
  if (payload.company !== undefined) patch.company = payload.company?.slice(0, 200) ?? null;

  // Collected from the custom block below, then applied together with the
  // scalar columns in one statement.
  let customPatch: Record<string, unknown> | null = null;
  let customRemove: string[] = [];

  // Custom values are type-checked here because a jsonb column cannot do it: an
  // unchecked write is how "AUM" ends up holding 2000000 on one row and "$2m"
  // on the next, and stops being sortable.
  if (payload.custom !== undefined && payload.custom !== null && typeof payload.custom === "object") {
    // Strict: a failed definitions read must not read as "this org has no
    // custom columns", which would silently discard every value sent and still
    // answer 200.
    let defs;
    try {
      defs = await loadFieldDefsStrict(supabase, auth.ctx.orgId, "contact");
    } catch (err) {
      console.error("[network/contact] field defs", err);
      return NextResponse.json(
        { error: "Failed to read this workspace's columns" },
        { status: 503 },
      );
    }

    const merged = applyCustomPatch(
      defs,
      (before.custom as Record<string, unknown>) ?? {},
      payload.custom,
    );
    if (!merged.ok) {
      return NextResponse.json({ error: merged.errors.join(" ") }, { status: 400 });
    }

    // Held until the single UPDATE below. Both the custom merge and the
    // ordinary columns go in one statement so a failure cannot leave half the
    // request written — and the jsonb merge still happens database-side
    // (`custom || patch`), so a concurrent edit to a different key on the same
    // row is not erased by a read-modify-write.
    const sent = payload.custom as Record<string, unknown>;
    customPatch = Object.fromEntries(
      Object.entries(merged.custom).filter(([key]) => key in sent),
    );
    customRemove = merged.removed;
  }

  if (Object.keys(patch).length === 0 && customPatch === null) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data: applied, error } = await supabase.rpc("network_contact_apply_patch", {
    target_org: auth.ctx.orgId,
    target_contact: id,
    scalars: patch,
    custom_patch: customPatch ?? {},
    remove_keys: customRemove,
  });

  if (error) {
    console.error("[network/contact] update", error);
    return NextResponse.json({ error: "Failed to update contact" }, { status: 500 });
  }
  // The function matches on (id, organization_id), so no row means the contact
  // is not this org's — or does not exist. Either way it is a 404, not a 500.
  if (!applied) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  const updated = applied as Record<string, any>;

  invalidateRoster(auth.ctx.orgId);

  // System timeline entries for the two changes a reviewer asks about. These
  // are is_system, so nobody can edit or delete them afterwards.
  const systemEntries: Record<string, unknown>[] = [];
  const auditActions: AuditAction[] = ["update"];

  if (patch.stage !== undefined && patch.stage !== before.stage) {
    systemEntries.push({
      organization_id: auth.ctx.orgId,
      contact_id: id,
      actor_id: auth.ctx.userId,
      activity_type: "stage_change",
      subject: `Stage changed to ${patch.stage}`,
      is_system: true,
      metadata: { from: before.stage, to: patch.stage },
    });
    auditActions.push("stage_change");
  }

  if (patch.relationship_owner !== undefined && patch.relationship_owner !== before.relationship_owner) {
    const names = await loadPrincipalNames(supabase, auth.ctx.orgId);
    const toName = patch.relationship_owner ? (names.get(String(patch.relationship_owner)) ?? "a teammate") : null;
    systemEntries.push({
      organization_id: auth.ctx.orgId,
      contact_id: id,
      actor_id: auth.ctx.userId,
      activity_type: "owner_change",
      subject: toName ? `Relationship assigned to ${toName}` : "Relationship unassigned",
      is_system: true,
      metadata: { from: before.relationship_owner, to: patch.relationship_owner },
    });
    auditActions.push("assign");
  }

  if (systemEntries.length > 0) {
    const { error: logError } = await supabase.from("network_activities").insert(systemEntries);
    if (logError) console.warn("[network/contact] system timeline entry failed", logError);
  }

  for (const action of auditActions) {
    await recordNetworkAudit(supabase, {
      orgId: auth.ctx.orgId,
      actorId: auth.ctx.userId,
      action,
      entityId: id,
      entityLabel: before.full_name ?? null,
      metadata: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
    });
  }

  const names = await loadPrincipalNames(supabase, auth.ctx.orgId);
  return NextResponse.json({
    contact: mapContactRecord(
      updated as Record<string, unknown>,
      names.get(String(updated.relationship_owner)) ?? null,
    ),
  });
}
