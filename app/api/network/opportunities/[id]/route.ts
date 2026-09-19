// PATCH / DELETE one deal.
//
// Stage moves are the interesting case and are decided by
// buildOpportunityPatch (pure, tested): moving into a terminal stage closes the
// deal, stamps the close time the constraint requires, and pins the probability
// so a closed deal stops distorting the weighted forecast. Every move is also
// written to the contact's timeline as a system entry.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  buildOpportunityPatch,
  loadOwnerNames,
  mapOpportunity,
  OPPORTUNITY_SELECT,
  STAGE_LABEL,
  isOpportunityStage,
  type OpportunityStatus,
} from "@/lib/network-opportunities";
import { loadFieldDefs } from "@/lib/network-field-defs.server";
import { recordNetworkAudit } from "@/lib/network-audit";
import { invalidateRoster } from "@/lib/network-roster";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-opportunity-update`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 120) },
    );
  }

  const { id } = await params;
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;

  const { data: before } = await supabase
    .from("network_opportunities")
    .select("id, name, stage, status, probability, closed_at, custom, contact_id, investor_id")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  // An owner must be a member of this org, or the deal is assigned to nobody
  // the team can see.
  if (payload.ownerId) {
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
  }

  const defs = await loadFieldDefs(supabase, auth.ctx.orgId, "opportunity");
  const result = buildOpportunityPatch(
    payload,
    {
      stage: isOpportunityStage(before.stage) ? before.stage : "sourced",
      status: (before.status as OpportunityStatus) ?? "open",
      probability: before.probability ?? 0,
      closedAt: before.closed_at ?? null,
      custom: (before.custom as Record<string, unknown>) ?? {},
    },
    defs,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.errors.join(" ") }, { status: 400 });
  }
  if (Object.keys(result.patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Clearing one counterparty is only safe if the other one survives.
  if (result.patch.contact_id === null && !before.investor_id && payload.investorId == null) {
    return NextResponse.json({ error: "A deal needs a contact or an investor." }, { status: 400 });
  }
  if (result.patch.investor_id === null && !before.contact_id && payload.contactId == null) {
    return NextResponse.json({ error: "A deal needs a contact or an investor." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("network_opportunities")
    .update({ ...result.patch, updated_at: new Date().toISOString() })
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .select(OPPORTUNITY_SELECT)
    .single();

  if (error || !data) {
    console.error("[network/opportunities] update", error);
    return NextResponse.json({ error: "Failed to update the deal" }, { status: 500 });
  }

  if (result.stageChange) {
    const { from, to } = result.stageChange;
    const { error: logError } = await supabase.from("network_activities").insert({
      organization_id: auth.ctx.orgId,
      contact_id: before.contact_id ?? null,
      investor_id: before.investor_id ?? null,
      opportunity_id: id,
      actor_id: auth.ctx.userId,
      activity_type: "stage_change",
      subject: `${before.name}: ${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}`,
      is_system: true,
      metadata: { opportunityId: id, from, to },
    });
    if (logError) console.warn("[network/opportunities] timeline entry failed", logError);
    // The trigger just moved the contact's last_activity_at.
    invalidateRoster(auth.ctx.orgId);
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: result.stageChange ? "stage_change" : "update",
    entityType: "network_opportunity",
    entityId: id,
    entityLabel: before.name ?? null,
    metadata: { fields: Object.keys(result.patch), stageChange: result.stageChange },
  });

  const owners = await loadOwnerNames(supabase, auth.ctx.orgId);
  return NextResponse.json({ opportunity: mapOpportunity(data, owners) });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const supabase = (await createServerClient()) as any;

  const { data: before } = await supabase
    .from("network_opportunities")
    .select("id, name")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  // RLS decides whether this caller may delete (creator or admin); a refusal
  // comes back as zero rows rather than an error, so the count is the check.
  const { error, count } = await supabase
    .from("network_opportunities")
    .delete({ count: "exact" })
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id);

  if (error) {
    console.error("[network/opportunities] delete", error);
    return NextResponse.json({ error: "Failed to delete the deal" }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json(
      { error: "Only the person who created this deal, or an admin, can delete it." },
      { status: 403 },
    );
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "delete",
    entityType: "network_opportunity",
    entityId: id,
    entityLabel: before.name ?? null,
  });

  return NextResponse.json({ ok: true });
}
