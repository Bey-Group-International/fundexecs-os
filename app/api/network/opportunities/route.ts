// The pipeline.
//
//   GET  — deals, filtered and grouped for the board, plus the stage rollup.
//   POST — create one.
//
// The rollup comes from network_pipeline_summary() rather than from summing the
// returned page: the board header has to describe the whole pipeline even when
// the list below it is filtered or paged.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import {
  isOpportunityStage,
  isOpportunityStatus,
  loadOwnerNames,
  mapOpportunity,
  OPPORTUNITY_SELECT,
  STAGE_DEFAULT_PROBABILITY,
  validateOpportunityRefs,
  type OpportunityStage,
} from "@/lib/network-opportunities";
import { loadFieldDefsStrict } from "@/lib/network-field-defs.server";
import { applyCustomPatch } from "@/lib/network-fields";
import { recordNetworkAudit } from "@/lib/network-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_LIMIT = 300;

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = req.nextUrl.searchParams;
  const parsed = parseInt(sp.get("limit") ?? "200", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : 200;

  const supabase = (await createServerClient()) as any;

  let query = supabase
    .from("network_opportunities")
    .select(OPPORTUNITY_SELECT)
    .eq("organization_id", auth.ctx.orgId);

  const status = sp.get("status");
  // The board shows live pipeline by default; closed deals are opt-in.
  if (status && isOpportunityStatus(status)) query = query.eq("status", status);
  else if (status !== "all") query = query.eq("status", "open");

  const stage = sp.get("stage");
  if (stage && isOpportunityStage(stage)) query = query.eq("stage", stage);

  const owner = sp.get("owner");
  if (owner === "me") query = query.eq("owner_id", auth.ctx.userId);
  else if (owner === "unassigned") query = query.is("owner_id", null);
  else if (owner) query = query.eq("owner_id", owner);

  const contactId = sp.get("contactId");
  if (contactId) query = query.eq("contact_id", contactId);

  const fundId = sp.get("fundId");
  if (fundId) query = query.eq("fund_id", fundId);

  const q = (sp.get("q") ?? "").trim();
  // Only the deal name is matched, and the term travels as a bound value —
  // never concatenated into a PostgREST filter expression.
  if (q) query = query.ilike("name", `%${q}%`);

  const [owners, summaryRes, { data, error }] = await Promise.all([
    loadOwnerNames(supabase, auth.ctx.orgId),
    supabase.rpc("network_pipeline_summary", { target_org: auth.ctx.orgId }),
    query.order("expected_close", { ascending: true, nullsFirst: false }).limit(limit),
  ]);

  if (error) {
    console.error("[network/opportunities] read", error);
    return NextResponse.json({ error: "Failed to load the pipeline" }, { status: 500 });
  }

  const summary = ((summaryRes?.data ?? []) as Record<string, any>[]).map((r) => ({
    stage: r.stage as OpportunityStage,
    dealCount: Number(r.deal_count ?? 0),
    targetTotal: Number(r.target_total ?? 0),
    weightedTotal: Math.round(Number(r.weighted_total ?? 0)),
  }));

  return NextResponse.json(
    {
      opportunities: (data ?? []).map((row: Record<string, any>) => mapOpportunity(row, owners)),
      summary,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-opportunity-create`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 60) },
    );
  }

  const payload = (await req.json().catch(() => null)) as {
    name?: string;
    stage?: string;
    contactId?: string | null;
    investorId?: string | null;
    fundId?: string | null;
    targetAmount?: number | string | null;
    currency?: string;
    probability?: number;
    expectedClose?: string | null;
    ownerId?: string | null;
    source?: string | null;
    notes?: string | null;
    custom?: Record<string, unknown>;
  } | null;

  const name = payload?.name?.trim();
  if (!name) return NextResponse.json({ error: "A deal needs a name." }, { status: 400 });
  if (!payload?.contactId && !payload?.investorId) {
    return NextResponse.json({ error: "A deal needs a contact or an investor." }, { status: 400 });
  }

  const stage: OpportunityStage = isOpportunityStage(payload.stage) ? payload.stage : "sourced";

  let targetAmount: number | null = null;
  if (payload.targetAmount !== undefined && payload.targetAmount !== null) {
    const cleaned = String(payload.targetAmount).replace(/[,$\s]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "Target amount must be a number." }, { status: 400 });
    }
    targetAmount = n;
  }

  let expectedClose: string | null = null;
  if (payload.expectedClose) {
    const ms = Date.parse(payload.expectedClose);
    if (Number.isNaN(ms)) {
      return NextResponse.json({ error: "Expected close must be a valid date." }, { status: 400 });
    }
    expectedClose = new Date(ms).toISOString().slice(0, 10);
  }

  if (payload.currency !== undefined && payload.currency !== null &&
      typeof payload.currency !== "string") {
    return NextResponse.json({ error: "Currency must be a 3-letter code." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;

  // Every relationship id the request supplied has to belong to this org. The
  // foreign keys are single-column, so nothing in the schema would stop a deal
  // pointing at another tenant's fund or investor.
  let refError: string | null;
  try {
    refError = await validateOpportunityRefs(supabase, auth.ctx.orgId, {
      contactId: payload.contactId,
      investorId: payload.investorId,
      fundId: payload.fundId,
      ownerId: payload.ownerId,
    });
  } catch (err) {
    console.error("[network/opportunities] ref check", err);
    return NextResponse.json({ error: "Failed to create the deal" }, { status: 500 });
  }
  if (refError) {
    return NextResponse.json(
      { error: refError },
      { status: refError.endsWith("not found") ? 404 : 400 },
    );
  }

  // Strict: a failed definitions read must not look like "this org has no
  // custom columns" and silently drop every value the request supplied.
  let defs;
  try {
    defs = await loadFieldDefsStrict(supabase, auth.ctx.orgId, "opportunity");
  } catch (err) {
    console.error("[network/opportunities] field defs", err);
    return NextResponse.json({ error: "Failed to read this workspace's columns" }, { status: 503 });
  }

  const merged = applyCustomPatch(defs, {}, payload.custom ?? {}, { creating: true });
  if (!merged.ok) {
    return NextResponse.json({ error: merged.errors.join(" ") }, { status: 400 });
  }

  const probability =
    typeof payload.probability === "number" &&
    payload.probability >= 0 &&
    payload.probability <= 100
      ? Math.round(payload.probability)
      : STAGE_DEFAULT_PROBABILITY[stage];

  const isTerminal = stage === "committed" || stage === "passed";

  const { data, error } = await supabase
    .from("network_opportunities")
    .insert({
      organization_id: auth.ctx.orgId,
      name: name.slice(0, 200),
      stage,
      status: isTerminal ? (stage === "committed" ? "won" : "lost") : "open",
      closed_at: isTerminal ? new Date().toISOString() : null,
      contact_id: payload.contactId ?? null,
      investor_id: payload.investorId ?? null,
      fund_id: payload.fundId ?? null,
      target_amount: targetAmount,
      currency: (payload.currency ?? "USD").toUpperCase().slice(0, 3),
      probability,
      expected_close: expectedClose,
      owner_id: payload.ownerId ?? auth.ctx.userId,
      created_by: auth.ctx.userId,
      source: payload.source?.slice(0, 120) ?? null,
      notes: payload.notes?.slice(0, 20_000) ?? null,
      custom: merged.custom,
    })
    .select(OPPORTUNITY_SELECT)
    .single();

  if (error || !data) {
    console.error("[network/opportunities] insert", error);
    return NextResponse.json({ error: "Failed to create the deal" }, { status: 500 });
  }

  // A new deal belongs on the person's timeline — otherwise the record page
  // shows a relationship with no sign that money is being discussed.
  const { error: logError } = await supabase.from("network_activities").insert({
    organization_id: auth.ctx.orgId,
    contact_id: payload.contactId ?? null,
    investor_id: payload.investorId ?? null,
    opportunity_id: data.id,
    actor_id: auth.ctx.userId,
    activity_type: "stage_change",
    subject: `Opened ${name} at ${stage}`,
    is_system: true,
    metadata: { opportunityId: data.id, stage, targetAmount },
  });
  if (logError) console.warn("[network/opportunities] timeline entry failed", logError);

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "create",
    entityType: "network_opportunity",
    entityId: String(data.id),
    entityLabel: name,
    metadata: { stage, targetAmount },
  });

  const owners = await loadOwnerNames(supabase, auth.ctx.orgId);
  return NextResponse.json({ opportunity: mapOpportunity(data, owners) });
}
