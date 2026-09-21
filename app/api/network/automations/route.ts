// The rule book.
//
//   GET    — every rule in the workspace, plus what a rule may be built from.
//   POST   — write one (admins; RLS enforces it too).
//   PATCH  — edit one, or just switch it on and off.
//   DELETE — remove one. The run log keeps what it already did.
//
// Reading is open to every member on purpose. A rule acts on other people's
// work, and somebody who finds a task they did not create is owed the ability
// to see which rule made it. Writing is admin-only for the same reason.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  isTriggerType,
  mapAutomation,
  validateAutomationBody,
  ACTION_LABEL,
  CONDITION_FIELDS,
  CONDITION_OPS,
  TRIGGER_DEFAULT_DAYS,
  TRIGGER_ENTITY,
  TRIGGER_LABEL,
  TRIGGER_TYPES,
} from "@/lib/network-automations";
import { loadOwnerNames, OPPORTUNITY_STAGES } from "@/lib/network-opportunities";
import { CONTACT_STAGES } from "@/lib/network-stages";
import { loadAllFieldDefs } from "@/lib/network-field-defs.server";
import { recordNetworkAudit } from "@/lib/network-audit";

export const dynamic = "force-dynamic";

const AUTOMATION_SELECT =
  "id, name, description, enabled, trigger_type, trigger_config, conditions, actions, " +
  "run_count, last_run_at, last_error, created_by, created_at, updated_at";

/** A workspace with hundreds of rules is a workspace nobody understands, and
 *  every one of them is evaluated on the writes it watches. */
const MAX_AUTOMATIONS = 50;

/** Which stage list a rule's trigger is about. A contact rule offering the
 *  pipeline's stages would let an admin write one that can never fire. */
function stagesFor(triggerType: string): readonly string[] {
  return TRIGGER_ENTITY[triggerType as keyof typeof TRIGGER_ENTITY] === "contact"
    ? CONTACT_STAGES
    : OPPORTUNITY_STAGES;
}

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = (await createServerClient()) as any;

  const { data, error } = await supabase
    .from("network_automations")
    .select(AUTOMATION_SELECT)
    .eq("organization_id", auth.ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_AUTOMATIONS + 1);

  if (error) {
    console.error("[network/automations] list", error);
    return NextResponse.json({ error: "Failed to read the rules" }, { status: 500 });
  }

  const [fields, owners] = await Promise.all([
    loadAllFieldDefs(supabase, auth.ctx.orgId),
    loadOwnerNames(supabase, auth.ctx.orgId),
  ]);

  return NextResponse.json({
    automations: ((data ?? []) as Record<string, unknown>[]).map(mapAutomation),
    // The vocabulary the builder renders itself from, so the form and the
    // validator can never disagree about what a rule may contain.
    options: {
      triggers: TRIGGER_TYPES.map((t) => ({
        value: t,
        label: TRIGGER_LABEL[t],
        entity: TRIGGER_ENTITY[t],
        defaultDays: TRIGGER_DEFAULT_DAYS[t as keyof typeof TRIGGER_DEFAULT_DAYS] ?? null,
      })),
      actions: Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label })),
      conditionFields: CONDITION_FIELDS,
      conditionOps: CONDITION_OPS,
      opportunityStages: OPPORTUNITY_STAGES,
      contactStages: CONTACT_STAGES,
      customFields: fields,
      // So a reassign action can offer a person rather than asking somebody to
      // paste a uuid. loadOwnerNames never throws; an empty list degrades the
      // picker to nothing offered, not to a broken form.
      owners: [...owners].map(([id, name]) => ({ id, name })),
    },
    canManage: auth.ctx.role === "owner" || auth.ctx.role === "admin",
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.ctx.role !== "owner" && auth.ctx.role !== "admin") {
    return NextResponse.json(
      { error: "Only organization admins can write automation rules." },
      { status: 403 },
    );
  }

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-automations`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 30) },
    );
  }

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "Nothing to create." }, { status: 400 });

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A rule needs a name." }, { status: 400 });

  if (!isTriggerType(payload.triggerType)) {
    return NextResponse.json({ error: "Choose what sets the rule off." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;

  const { count, error: countError } = await supabase
    .from("network_automations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.ctx.orgId);
  if (countError) {
    console.error("[network/automations] count", countError);
    return NextResponse.json({ error: "Failed to create the rule" }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_AUTOMATIONS) {
    return NextResponse.json(
      { error: `This workspace already has ${MAX_AUTOMATIONS} rules. Retire one first.` },
      { status: 400 },
    );
  }

  // Custom columns are read strictly: a set_field action naming a column that
  // could not be read would be rejected as unknown, which is the right answer
  // only if the read succeeded. Failing loudly beats storing a rule that
  // silently does nothing.
  let customKeys: string[];
  try {
    const entity = TRIGGER_ENTITY[payload.triggerType];
    const fields = await loadAllFieldDefs(supabase, auth.ctx.orgId);
    customKeys = (entity === "contact" ? fields.contact : fields.opportunity).map((f) => f.key);
  } catch (err) {
    console.error("[network/automations] field defs", err);
    return NextResponse.json({ error: "Failed to read this workspace's columns" }, { status: 503 });
  }

  const validated = validateAutomationBody(
    payload.triggerType,
    payload.triggerConfig,
    payload.conditions,
    payload.actions,
    { stages: stagesFor(payload.triggerType), customKeys },
  );
  if (!validated.ok) {
    return NextResponse.json({ error: validated.errors.join(" ") }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("network_automations")
    .insert({
      organization_id: auth.ctx.orgId,
      name: name.slice(0, 200),
      description:
        typeof payload.description === "string" ? payload.description.slice(0, 1000) : null,
      // A new rule starts switched OFF unless the request says otherwise. It
      // will act on other people's work unattended, and the run log only shows
      // what it did after it has already done it — the author should get to
      // read the rule back before it starts.
      enabled: payload.enabled === true,
      trigger_type: payload.triggerType,
      trigger_config: validated.value.triggerConfig,
      conditions: validated.value.conditions,
      actions: validated.value.actions,
      created_by: auth.ctx.userId,
    })
    .select(AUTOMATION_SELECT)
    .single();

  if (error) {
    // 23505 — the (organization_id, name) unique index.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A rule with that name already exists." }, { status: 409 });
    }
    console.error("[network/automations] insert", error);
    return NextResponse.json({ error: "Failed to create the rule" }, { status: 500 });
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "create",
    entityType: "network_automation",
    entityId: String((data as { id: unknown }).id),
    entityLabel: name,
    metadata: { triggerType: payload.triggerType },
  });

  return NextResponse.json({ automation: mapAutomation(data as Record<string, unknown>) });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (auth.ctx.role !== "owner" && auth.ctx.role !== "admin") {
    return NextResponse.json(
      { error: "Only organization admins can change automation rules." },
      { status: 403 },
    );
  }

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  const id = typeof payload.id === "string" ? payload.id : "";
  if (!id) return NextResponse.json({ error: "Which rule?" }, { status: 400 });

  const supabase = (await createServerClient()) as any;

  const { data: before } = await supabase
    .from("network_automations")
    .select("id, name, trigger_type, trigger_config, conditions, actions")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if (payload.name !== undefined) {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) return NextResponse.json({ error: "A rule needs a name." }, { status: 400 });
    patch.name = name.slice(0, 200);
  }
  if (payload.description !== undefined) {
    patch.description =
      typeof payload.description === "string" ? payload.description.slice(0, 1000) : null;
  }
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be true or false." }, { status: 400 });
    }
    patch.enabled = payload.enabled;
    // Switching a rule back on clears the error from its last failure, so the
    // list stops showing a warning about a run that has been dealt with.
    if (payload.enabled) patch.last_error = null;
  }

  // The logic half is re-validated whole. Accepting a partial edit — new
  // actions against the stored trigger, say — would let a rule reach a state
  // neither the old nor the new request ever described.
  const touchesLogic =
    payload.triggerType !== undefined ||
    payload.triggerConfig !== undefined ||
    payload.conditions !== undefined ||
    payload.actions !== undefined;

  if (touchesLogic) {
    const triggerType =
      payload.triggerType === undefined ? String(before.trigger_type) : payload.triggerType;
    if (!isTriggerType(triggerType)) {
      return NextResponse.json({ error: "Unknown trigger." }, { status: 400 });
    }

    let customKeys: string[];
    try {
      const entity = TRIGGER_ENTITY[triggerType];
      const fields = await loadAllFieldDefs(supabase, auth.ctx.orgId);
      customKeys = (entity === "contact" ? fields.contact : fields.opportunity).map((f) => f.key);
    } catch (err) {
      console.error("[network/automations] field defs", err);
      return NextResponse.json(
        { error: "Failed to read this workspace's columns" },
        { status: 503 },
      );
    }

    const validated = validateAutomationBody(
      triggerType,
      payload.triggerConfig === undefined ? before.trigger_config : payload.triggerConfig,
      payload.conditions === undefined ? before.conditions : payload.conditions,
      payload.actions === undefined ? before.actions : payload.actions,
      { stages: stagesFor(triggerType), customKeys },
    );
    if (!validated.ok) {
      return NextResponse.json({ error: validated.errors.join(" ") }, { status: 400 });
    }

    patch.trigger_type = triggerType;
    patch.trigger_config = validated.value.triggerConfig;
    patch.conditions = validated.value.conditions;
    patch.actions = validated.value.actions;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("network_automations")
    .update(patch)
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .select(AUTOMATION_SELECT)
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A rule with that name already exists." }, { status: 409 });
    }
    console.error("[network/automations] update", error);
    return NextResponse.json({ error: "Failed to update the rule" }, { status: 500 });
  }
  // RLS refuses a non-admin by returning no rows rather than an error. The
  // role check above already covers it; this is the boundary saying so too.
  if (!data) {
    return NextResponse.json(
      { error: "Only organization admins can change automation rules." },
      { status: 403 },
    );
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "update",
    entityType: "network_automation",
    entityId: id,
    entityLabel: (before.name as string) ?? null,
    metadata: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ automation: mapAutomation(data as Record<string, unknown>) });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which rule?" }, { status: 400 });

  const supabase = (await createServerClient()) as any;

  const { data: before } = await supabase
    .from("network_automations")
    .select("id, name")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  const { error, count } = await supabase
    .from("network_automations")
    .delete({ count: "exact" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id);

  if (error) {
    console.error("[network/automations] delete", error);
    return NextResponse.json({ error: "Failed to delete the rule" }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json(
      { error: "Only organization admins can delete automation rules." },
      { status: 403 },
    );
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "delete",
    entityType: "network_automation",
    entityId: id,
    entityLabel: (before.name as string) ?? null,
  });

  return NextResponse.json({ ok: true });
}
