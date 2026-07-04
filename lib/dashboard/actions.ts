"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import type { AgentKey, Hub, InvestorType } from "@/lib/supabase/database.types";
import { createServerClient } from "@/lib/supabase/server";
import { writeDashboardAudit } from "./audit";
import { canManageDashboard, dashboardPermissionError } from "./permissions";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nullableText(formData: FormData, key: string): string | null {
  const value = text(formData, key);
  return value || null;
}

function nullableMoney(formData: FormData, key: string): number | null {
  const value = text(formData, key).replace(/[$,]/g, "");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dashboardPaths() {
  [
    "/dashboard",
    "/dashboard/capital",
    "/dashboard/deals",
    "/dashboard/fund-room",
    "/dashboard/investor-relations",
    "/dashboard/automation",
    "/dashboard/marketing",
  ].forEach((path) => revalidatePath(path));
}

async function contextOrThrow() {
  const ctx = await getSessionContext();
  if (!canManageDashboard(ctx)) throw new Error(dashboardPermissionError(ctx));
  return ctx;
}

export async function createDashboardInvestor(formData: FormData) {
  const ctx = await contextOrThrow();
  const name = text(formData, "name");
  if (!name) throw new Error("Investor name is required.");

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("investors")
    .insert({
      organization_id: ctx.orgId,
      name,
      investor_type: (text(formData, "investor_type") || "lp") as InvestorType,
      contact_name: nullableText(formData, "contact_name"),
      contact_email: nullableText(formData, "contact_email"),
      pipeline_stage: text(formData, "pipeline_stage") || "prospect",
      typical_check_min: nullableMoney(formData, "typical_check_min"),
      typical_check_max: nullableMoney(formData, "typical_check_max"),
      notes: nullableText(formData, "notes"),
    })
    .select("id, name, pipeline_stage")
    .single();
  if (error) throw new Error(error.message);

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "investor.created",
    entityType: "investor",
    entityId: data.id,
    afterState: data,
  });
  dashboardPaths();
}

export async function createDashboardDeal(formData: FormData) {
  const ctx = await contextOrThrow();
  const name = text(formData, "name");
  if (!name) throw new Error("Deal name is required.");

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deals")
    .insert({
      organization_id: ctx.orgId,
      name,
      stage: "sourced",
      asset_class: nullableText(formData, "asset_class"),
      geography: nullableText(formData, "geography"),
      target_amount: nullableMoney(formData, "target_amount"),
      source: nullableText(formData, "source") ?? "Dashboard",
      lead_principal: ctx.userId,
      notes: nullableText(formData, "notes"),
    })
    .select("id, name, stage")
    .single();
  if (error) throw new Error(error.message);

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "deal.created",
    entityType: "deal",
    entityId: data.id,
    afterState: data,
  });
  dashboardPaths();
}

export async function createDashboardFund(formData: FormData) {
  const ctx = await contextOrThrow();
  const name = text(formData, "name");
  if (!name) throw new Error("Fund name is required.");

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("funds")
    .insert({
      organization_id: ctx.orgId,
      name,
      fund_type: "fund",
      vintage_year: Number(text(formData, "vintage_year")) || null,
      target_size: nullableMoney(formData, "target_size"),
      committed_capital: nullableMoney(formData, "committed_capital") ?? 0,
      currency: "USD",
    })
    .select("id, name, target_size, committed_capital")
    .single();
  if (error) throw new Error(error.message);

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "fund.created",
    entityType: "fund",
    entityId: data.id,
    afterState: data,
  });
  dashboardPaths();
}

export async function createDashboardTask(formData: FormData) {
  const ctx = await contextOrThrow();
  const title = text(formData, "title");
  if (!title) throw new Error("Task title is required.");

  const hub = (text(formData, "hub") || "source") as Hub;
  const assignedAgent = (text(formData, "assigned_agent") || "associate") as AgentKey;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: ctx.orgId,
      title,
      description: nullableText(formData, "description"),
      hub,
      assigned_agent: assignedAgent,
      status: "pending",
      progress: 0,
      requires_approval: false,
      created_by: ctx.userId,
      step_order: 0,
    })
    .select("id, title, hub, assigned_agent")
    .single();
  if (error) throw new Error(error.message);

  await writeDashboardAudit({
    organizationId: ctx.orgId,
    principalId: ctx.userId,
    action: "task.created",
    entityType: "task",
    entityId: data.id,
    afterState: data,
  });
  dashboardPaths();
}
