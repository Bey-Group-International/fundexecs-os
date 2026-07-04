"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext, requireOrgContext } from "@/lib/auth";
import { nextRun } from "@/lib/cron";
import type { AgentKey, DealStage, AssetType, ArtifactType, Hub, Json } from "@/lib/supabase/database.types";

// One-click demo data so the Command Center, pipeline, and Automations look
// alive in a walkthrough — without running (and paying for) live workflows.
// Everything is tagged by name so the seed is idempotent and fully reversible
// via the Reset button.

const DEMO_DEALS: {
  name: string;
  stage: DealStage;
  asset_class: string;
  geography: string;
  target_amount: number;
}[] = [
  { name: "Cedar Ridge Multifamily", stage: "sourced", asset_class: "Multifamily", geography: "Austin, TX", target_amount: 45_000_000 },
  { name: "Atlas Logistics Portfolio", stage: "screening", asset_class: "Industrial", geography: "Phoenix, AZ", target_amount: 120_000_000 },
  { name: "Meridian SaaS Buyout", stage: "diligence", asset_class: "SaaS", geography: "Remote · US", target_amount: 80_000_000 },
  { name: "Harbor Point Office", stage: "ic_review", asset_class: "Office", geography: "Boston, MA", target_amount: 65_000_000 },
  { name: "Summit Hospitality Group", stage: "closing", asset_class: "Hospitality", geography: "Denver, CO", target_amount: 95_000_000 },
];

const DEMO_ASSETS: { name: string; asset_type: AssetType; current_value: number }[] = [
  { name: "Cedar Ridge Apartments", asset_type: "real_estate", current_value: 47_500_000 },
  { name: "Atlas DC-1 Warehouse", asset_type: "real_estate", current_value: 38_000_000 },
  { name: "Meridian Software Co.", asset_type: "operating_company", current_value: 82_000_000 },
];

const DEMO_ARTIFACTS: { title: string; artifact_type: ArtifactType; agent: AgentKey; hub: Hub; content: string }[] = [
  { title: "IC Memo — Cedar Ridge Multifamily", artifact_type: "ic_memo", agent: "analyst", hub: "run", content: "Recommendation: advance to diligence. Base-case 5-yr IRR 18.4%, 2.1x MOIC at a 6.0% entry cap. Submarket absorption remains positive; rent growth modeled at 3.5%." },
  { title: "Underwriting Model — Atlas Logistics", artifact_type: "model", agent: "analyst", hub: "run", content: "LBO: $120M TEV, 55% LTV, entry 6.2% / exit 5.8% cap. Base IRR 21.3%, downside 12.1%. Sensitivity to exit cap and rent bridge attached." },
  { title: "Diligence Risk Report — Meridian SaaS", artifact_type: "risk_report", agent: "diligence", hub: "run", content: "3 medium flags: customer concentration (top-2 = 31% ARR), month-to-month contracts on 18% of base, and a key-person dependency in engineering. No red flags." },
  { title: "Q2 LP Update", artifact_type: "lp_update", agent: "investor_relations", hub: "execute", content: "Portfolio NAV +4.2% QoQ. Two acquisitions closed (Cedar Ridge, Atlas DC-1). Dry powder $140M. Next capital call scheduled for July 15." },
];

const DEMO_WORKFLOWS: { title: string; hub: Hub; agent: AgentKey; steps: { title: string; agent: AgentKey; output: string }[] }[] = [
  {
    title: "Source multifamily targets in Texas",
    hub: "source",
    agent: "associate",
    steps: [
      { title: "Source targets", agent: "associate", output: "Surfaced 12 candidates matching the Sun Belt multifamily thesis; 4 cleared the initial screen." },
      { title: "Screen candidates", agent: "analyst", output: "Ranked by thesis fit; Cedar Ridge scores highest on rent growth and basis." },
    ],
  },
  {
    title: "Underwrite Atlas Logistics Portfolio",
    hub: "run",
    agent: "analyst",
    steps: [
      { title: "Build the model", agent: "analyst", output: "Constructed the base-case LBO across 3 assets with a blended 6.2% entry cap." },
      { title: "Run sensitivities", agent: "analyst", output: "Stressed exit cap ±75bps and rent bridge; IRR range 12.1%–24.6%." },
      { title: "Summarize for IC", agent: "associate", output: "Drafted the IC recommendation: proceed, subject to lender term confirmation." },
    ],
  },
];

const DEMO_AUTOMATION = {
  name: "Weekly pipeline digest",
  prompt:
    "Every Monday, scan our deal pipeline and draft a one-page summary of what moved this week. Flag any deal stuck in the same stage for more than 14 days.",
  schedule: "0 13 * * 1",
};

const DEMO_SESSION_GROUP = "Texas Multifamily Raise";
const DEMO_SESSIONS: { name: string; origin: "earn" | "workflow"; grouped: boolean }[] = [
  { name: "Source multifamily targets in Texas", origin: "earn", grouped: true },
  { name: "Underwrite Atlas Logistics Portfolio", origin: "earn", grouped: true },
  { name: "Weekly pipeline digest", origin: "workflow", grouped: false },
];

// Tie a couple of demo records to the session that "produced" them (migration
// 0022), so opening a session's Deal Pipeline / Asset Management frame shows
// only its scoped rows — while the hub views still show the whole book.
const DEMO_SESSION_LINKS: { session: string; deals: string[]; assets: string[] }[] = [
  { session: "Source multifamily targets in Texas", deals: ["Cedar Ridge Multifamily"], assets: [] },
  {
    session: "Underwrite Atlas Logistics Portfolio",
    deals: ["Atlas Logistics Portfolio"],
    assets: ["Atlas DC-1 Warehouse"],
  },
];

function demoTaskTitles(): string[] {
  return DEMO_WORKFLOWS.flatMap((w) => [w.title, ...w.steps.map((s) => s.title)]);
}

type Client = Awaited<ReturnType<typeof createServerClient>>;

// Delete all demo rows for an org. No revalidation — callers handle that so we
// don't double-revalidate when seeding (which clears first).
async function deleteDemoRows(supabase: Client, org: string): Promise<void> {
  await supabase.from("artifacts").delete().eq("organization_id", org).in("title", DEMO_ARTIFACTS.map((a) => a.title));
  await supabase.from("tasks").delete().eq("organization_id", org).in("title", demoTaskTitles());
  await supabase.from("sessions").delete().eq("organization_id", org).in("name", DEMO_SESSIONS.map((s) => s.name));
  await supabase.from("session_groups").delete().eq("organization_id", org).eq("name", DEMO_SESSION_GROUP);
  await supabase.from("deals").delete().eq("organization_id", org).in("name", DEMO_DEALS.map((d) => d.name));
  await supabase.from("assets").delete().eq("organization_id", org).in("name", DEMO_ASSETS.map((a) => a.name));
  await supabase.from("automations").delete().eq("organization_id", org).eq("name", DEMO_AUTOMATION.name);
}

export async function clearDemoData(): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const supabase = await createServerClient();
  await deleteDemoRows(supabase, ctx.orgId);
  revalidatePath("/dashboard");
  revalidatePath("/automations");
}

// --- Delete / Clear actions -------------------------------------------------

export async function deleteWorkflow(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .is("parent_task_id", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/grid/review");
  return { ok: true };
}

export async function clearWorkflows(): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("organization_id", auth.ctx.orgId)
    .is("parent_task_id", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  revalidatePath("/grid/review");
  return { ok: true };
}

export async function deleteDeal(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("deals")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

// Soft-archives every deal for the org rather than deleting — a hard DELETE
// here used to cascade to every document, underwriting, and diligence item
// tied to those deals (supabase/migrations/0005_deals.sql), with no undo
// short of a database restore, behind a single dismissible confirm(). This
// mirrors the archived_at pattern the rest of the app already uses for the
// same table (app/(app)/[hub]/[module]/actions.ts's clearDealsAction), so a
// mis-click is recoverable instead of permanent.
export async function clearDeals(): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("deals")
    .update({ archived_at: new Date().toISOString() })
    .eq("organization_id", auth.ctx.orgId)
    .is("archived_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteArtifact(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("artifacts")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function clearArtifacts(): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("artifacts")
    .delete()
    .eq("organization_id", auth.ctx.orgId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

// ---------------------------------------------------------------------------

export async function seedDemoData(): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const supabase = await createServerClient();
  const org = ctx.orgId;
  const by = ctx.userId;

  // Idempotent: clear any prior demo rows first (revalidation happens once below).
  await deleteDemoRows(supabase, org);

  const now = new Date().toISOString();

  await supabase.from("deals").insert(
    DEMO_DEALS.map((d) => ({
      organization_id: org,
      name: d.name,
      stage: d.stage,
      asset_class: d.asset_class,
      geography: d.geography,
      target_amount: d.target_amount,
      source: "Demo",
      lead_principal: by,
    })),
  );

  await supabase.from("assets").insert(
    DEMO_ASSETS.map((a) => ({
      organization_id: org,
      name: a.name,
      asset_type: a.asset_type,
      current_value: a.current_value,
      status: "active",
    })),
  );

  // Completed workflows + their steps, so the Workflows / Deliverables stats and
  // recent-workflow list populate.
  for (const wf of DEMO_WORKFLOWS) {
    const { data: parent } = await supabase
      .from("tasks")
      .insert({
        organization_id: org,
        title: wf.title,
        hub: wf.hub,
        assigned_agent: wf.agent,
        status: "completed",
        progress: 1,
        requires_approval: false,
        created_by: by,
        step_order: 0,
        completed_at: now,
        result: { steps: wf.steps.map((s) => s.title) } as Json,
      })
      .select("id")
      .single();

    for (let i = 0; i < wf.steps.length; i++) {
      const s = wf.steps[i];
      await supabase.from("tasks").insert({
        organization_id: org,
        parent_task_id: parent?.id ?? null,
        title: s.title,
        hub: wf.hub,
        assigned_agent: s.agent,
        status: "completed",
        progress: 1,
        requires_approval: false,
        created_by: by,
        step_order: i + 1,
        completed_at: now,
        result: { output: s.output } as Json,
      });
    }
  }

  // Standalone showcase deliverables for the "Latest deliverables" panel.
  await supabase.from("artifacts").insert(
    DEMO_ARTIFACTS.map((a) => ({
      organization_id: org,
      title: a.title,
      artifact_type: a.artifact_type,
      agent: a.agent,
      hub: a.hub,
      content: a.content,
      created_by: by,
    })),
  );

  await supabase.from("automations").insert({
    organization_id: org,
    name: DEMO_AUTOMATION.name,
    prompt: DEMO_AUTOMATION.prompt,
    trigger_type: "schedule",
    schedule: DEMO_AUTOMATION.schedule,
    auto_approve: false,
    enabled: true,
    next_run_at: nextRun(DEMO_AUTOMATION.schedule, new Date())?.toISOString() ?? null,
    created_by: by,
  });

  // A named group + a few sessions so the Sessions panel shows the grouped model.
  const { data: group } = await supabase
    .from("session_groups")
    .insert({ organization_id: org, name: DEMO_SESSION_GROUP, created_by: by })
    .select("id")
    .single();
  const { data: insertedSessions } = await supabase
    .from("sessions")
    .insert(
      DEMO_SESSIONS.map((s) => ({
        organization_id: org,
        name: s.name,
        origin: s.origin,
        group_id: s.grouped ? group?.id ?? null : null,
        created_by: by,
      })),
    )
    .select("id, name");

  // Scope a couple of demo deals/assets to their originating session so the
  // in-session module frames show real, focused data.
  const sessionIdByName = new Map((insertedSessions ?? []).map((s) => [s.name, s.id]));
  for (const link of DEMO_SESSION_LINKS) {
    const sid = sessionIdByName.get(link.session);
    if (!sid) continue;
    if (link.deals.length) {
      await supabase
        .from("deals")
        .update({ session_id: sid })
        .eq("organization_id", org)
        .in("name", link.deals);
    }
    if (link.assets.length) {
      await supabase
        .from("assets")
        .update({ session_id: sid })
        .eq("organization_id", org)
        .in("name", link.assets);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/automations");
}
