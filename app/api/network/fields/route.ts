// The organization's own columns.
//
//   GET    — every active definition, for the workspace to render.
//   POST   — define a column (admins; RLS enforces it too).
//   PATCH  — rename, reorder, change options, or retire one.
//   DELETE — retire a column. It is ARCHIVED, never dropped: the values already
//            recorded against it stay in each row's jsonb, so removing a column
//            from the view can't destroy data someone entered.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  isFieldEntity,
  isFieldType,
  isValidFieldKey,
  mapFieldDef,
  slugifyFieldKey,
} from "@/lib/network-fields";
import { loadAllFieldDefs } from "@/lib/network-field-defs.server";
import { recordNetworkAudit } from "@/lib/network-audit";

export const dynamic = "force-dynamic";

const MAX_FIELDS_PER_ENTITY = 60;

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = (await createServerClient()) as any;
  const fields = await loadAllFieldDefs(supabase, auth.ctx.orgId);

  return NextResponse.json({
    fields,
    // Defining columns is an admin act; the UI hides the editor for everyone
    // else rather than letting them hit a refusal from RLS.
    canManage: auth.ctx.role === "owner" || auth.ctx.role === "admin",
  });
}

function normaliseOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim().slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, 100);
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.ctx.role !== "owner" && auth.ctx.role !== "admin") {
    return NextResponse.json(
      { error: "Only organization admins can add columns." },
      { status: 403 },
    );
  }

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-fields`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 30) },
    );
  }

  const payload = (await req.json().catch(() => null)) as {
    entity?: string;
    label?: string;
    key?: string;
    type?: string;
    options?: unknown;
    helpText?: string;
    required?: boolean;
  } | null;

  // Parsed JSON, so the cast above is a description of intent, not a promise.
  // `{ "label": 1 }` used to throw on .trim() and return a 500.
  for (const field of ["label", "key", "helpText"] as const) {
    const v = payload?.[field];
    if (v !== undefined && v !== null && typeof v !== "string") {
      return NextResponse.json({ error: `${field} must be text.` }, { status: 400 });
    }
  }

  const label = payload?.label?.trim();
  if (!label) return NextResponse.json({ error: "A column needs a name." }, { status: 400 });

  const entity = isFieldEntity(payload?.entity) ? payload.entity : "contact";
  const type = isFieldType(payload?.type) ? payload.type : "text";
  const key = payload?.key?.trim() || slugifyFieldKey(label);

  if (!key || !isValidFieldKey(key)) {
    return NextResponse.json(
      { error: "That column name can't be turned into a valid key. Use letters and numbers." },
      { status: 400 },
    );
  }

  const options = normaliseOptions(payload?.options);
  if ((type === "select" || type === "multi_select") && options.length === 0) {
    return NextResponse.json(
      { error: "A choice column needs at least one option." },
      { status: 400 },
    );
  }

  const supabase = (await createServerClient()) as any;

  const { count } = await supabase
    .from("network_field_defs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.ctx.orgId)
    .eq("entity", entity)
    .is("archived_at", null);

  if ((count ?? 0) >= MAX_FIELDS_PER_ENTITY) {
    return NextResponse.json(
      { error: `A workspace can have at most ${MAX_FIELDS_PER_ENTITY} custom columns per object.` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("network_field_defs")
    .insert({
      organization_id: auth.ctx.orgId,
      entity,
      field_key: key,
      label: label.slice(0, 120),
      field_type: type,
      options,
      help_text: payload?.helpText?.slice(0, 300) || null,
      is_required: payload?.required === true,
      position: count ?? 0,
      created_by: auth.ctx.userId,
    })
    .select("id, entity, field_key, label, field_type, options, help_text, is_required, position")
    .single();

  if (error) {
    // The unique(organization_id, entity, field_key) index is the guard here.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "A column with that name already exists for this object." },
        { status: 409 },
      );
    }
    console.error("[network/fields] insert", error);
    return NextResponse.json({ error: "Failed to add the column" }, { status: 500 });
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "create",
    entityType: "network_field_def",
    entityId: String(data.id),
    entityLabel: label,
    metadata: { entity, type, key },
  });

  return NextResponse.json({ field: mapFieldDef(data) });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.ctx.role !== "owner" && auth.ctx.role !== "admin") {
    return NextResponse.json(
      { error: "Only organization admins can change columns." },
      { status: 403 },
    );
  }

  const payload = (await req.json().catch(() => null)) as {
    id?: string;
    label?: string;
    options?: unknown;
    helpText?: string | null;
    required?: boolean;
    position?: number;
    restore?: boolean;
  } | null;

  if (!payload?.id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  for (const field of ["label", "helpText"] as const) {
    const v = payload[field];
    if (v !== undefined && v !== null && typeof v !== "string") {
      return NextResponse.json({ error: `${field} must be text.` }, { status: 400 });
    }
  }

  const patch: Record<string, unknown> = {};
  if (payload.label !== undefined) {
    const label = payload.label.trim();
    if (!label) return NextResponse.json({ error: "A column needs a name." }, { status: 400 });
    patch.label = label.slice(0, 120);
  }
  // field_key and field_type are deliberately immutable: both are already
  // written into every row's jsonb, and changing either would orphan or
  // misinterpret values that are already recorded.
  if (payload.options !== undefined) patch.options = normaliseOptions(payload.options);
  if (payload.helpText !== undefined) patch.help_text = payload.helpText?.slice(0, 300) || null;
  if (payload.required !== undefined) patch.is_required = payload.required === true;
  if (payload.position !== undefined && Number.isFinite(payload.position)) {
    patch.position = Math.max(0, Math.trunc(payload.position));
  }
  if (payload.restore === true) patch.archived_at = null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;

  // POST refuses a choice column with no options; PATCH used to allow emptying
  // one, which leaves a select on screen that nobody can pick a value from.
  // field_type is immutable, so the stored one is the one that matters.
  if (payload.options !== undefined) {
    const { data: existing, error: readError } = await supabase
      .from("network_field_defs")
      .select("field_type")
      .eq("organization_id", auth.ctx.orgId)
      .eq("id", payload.id)
      .maybeSingle();

    if (readError) {
      console.error("[network/fields] read for options", readError);
      return NextResponse.json({ error: "Failed to update the column" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Column not found" }, { status: 404 });
    }
    const isChoice = existing.field_type === "select" || existing.field_type === "multi_select";
    if (isChoice && (patch.options as string[]).length === 0) {
      return NextResponse.json(
        { error: "A choice column needs at least one option." },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("network_field_defs")
    .update(patch)
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", payload.id)
    .select("id, entity, field_key, label, field_type, options, help_text, is_required, position")
    .maybeSingle();

  // .single() raises PGRST116 for zero rows, which would turn an unknown id —
  // or one belonging to another org — into a 500.
  if (error) {
    console.error("[network/fields] update", error);
    return NextResponse.json({ error: "Failed to update the column" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "update",
    entityType: "network_field_def",
    entityId: payload.id,
    entityLabel: data.label,
    metadata: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ field: mapFieldDef(data) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.ctx.role !== "owner" && auth.ctx.role !== "admin") {
    return NextResponse.json(
      { error: "Only organization admins can remove columns." },
      { status: 403 },
    );
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const supabase = (await createServerClient()) as any;

  // Archive, don't delete. Every row that holds a value for this key keeps it,
  // so retiring a column is reversible and never silently destroys data.
  const { data, error } = await supabase
    .from("network_field_defs")
    .update({ archived_at: new Date().toISOString() })
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .select("id, label")
    .maybeSingle();

  if (error) {
    console.error("[network/fields] archive", error);
    return NextResponse.json({ error: "Failed to remove the column" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "archive",
    entityType: "network_field_def",
    entityId: id,
    entityLabel: data.label,
  });

  return NextResponse.json({ ok: true, archived: true });
}
