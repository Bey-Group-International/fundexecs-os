"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { extractOwnership } from "@/lib/claude";
import type { Entity } from "@/lib/supabase/database.types";
import type { ParsedHoldingRow } from "@/lib/holdings-csv";

const ENTITY = "/build/entity";

function num(raw: FormDataEntryValue | null): number | null {
  const v = String(raw ?? "").trim();
  if (v === "") return null;
  const n = Number(v.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const text = (raw: FormDataEntryValue | null): string | null => {
  const v = String(raw ?? "").trim();
  return v === "" ? null : v;
};

const STAKE_KINDS = new Set(["person", "entity", "investor", "fund", "pool", "other"]);

export async function addStakeholder(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const kind = String(formData.get("kind") ?? "person").trim();
  const supabase = await createServerClient();
  await supabase.from("stakeholders").insert({
    organization_id: ctx.orgId,
    name,
    kind: STAKE_KINDS.has(kind) ? kind : "person",
    email: text(formData.get("email")),
    created_by: ctx.userId,
  });
  revalidatePath(ENTITY);
}

export async function deleteStakeholder(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createServerClient();
  await supabase.from("stakeholders").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath(ENTITY);
}

export async function addShareClass(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const entity_id = String(formData.get("entity_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!entity_id || !name) return;
  const supabase = await createServerClient();
  await supabase.from("share_classes").insert({
    organization_id: ctx.orgId,
    entity_id,
    name,
    kind: String(formData.get("kind") ?? "common").trim() || "common",
    authorized_units: num(formData.get("authorized_units")),
  });
  revalidatePath(ENTITY);
}

export async function addHolding(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const entity_id = String(formData.get("entity_id") ?? "");
  const stakeholder_id = String(formData.get("stakeholder_id") ?? "");
  if (!entity_id || !stakeholder_id) return;
  const supabase = await createServerClient();
  await supabase.from("equity_holdings").insert({
    organization_id: ctx.orgId,
    entity_id,
    stakeholder_id,
    share_class_id: text(formData.get("share_class_id")),
    units: num(formData.get("units")),
    ownership_pct: num(formData.get("ownership_pct")),
    invested_amount: num(formData.get("invested_amount")),
    created_by: ctx.userId,
  });
  revalidatePath(ENTITY);
}

export async function updateHolding(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing holding id" };

  const ownership_pct = num(formData.get("ownership_pct"));
  if (ownership_pct != null && (ownership_pct < 0 || ownership_pct > 100)) {
    return { error: "Ownership % must be between 0 and 100." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("equity_holdings")
    .update({
      units: num(formData.get("units")),
      ownership_pct,
      invested_amount: num(formData.get("invested_amount")),
      share_class_id: text(formData.get("share_class_id")),
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) return { error: error.message };
  revalidatePath(ENTITY);
  return { ok: true };
}

export async function deleteHolding(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createServerClient();
  await supabase.from("equity_holdings").delete().eq("id", id).eq("organization_id", ctx.orgId);
  revalidatePath(ENTITY);
}

// Earn drafts the cap table for an entity from a plain description: it extracts
// holders + ownership, creates any missing stakeholders, and inserts holdings.
export async function draftOwnershipWithEarn(
  entityId: string,
  description: string,
): Promise<{ created: number } | { error: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  if (!description.trim()) return { error: "Describe the ownership first." };

  const supabase = await createServerClient();
  const { data: ent } = await supabase
    .from("entities")
    .select("*")
    .eq("id", entityId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const entity = ent as Entity | null;
  if (!entity) return { error: "Entity not found" };

  const rows = await extractOwnership({ description, entityName: entity.name });
  if (!rows.length) return { error: "Couldn't find any holders to add — try naming them with percentages." };

  // Resolve/insert stakeholders by name (case-insensitive within the org).
  const { data: existingRows } = await supabase
    .from("stakeholders")
    .select("id,name")
    .eq("organization_id", ctx.orgId);
  const byName = new Map((existingRows ?? []).map((s) => [s.name.toLowerCase(), s.id]));

  let created = 0;
  for (const r of rows) {
    const key = r.stakeholder.trim().toLowerCase();
    if (!key) continue;
    let stakeholderId = byName.get(key);
    if (!stakeholderId) {
      const { data: ins } = await supabase
        .from("stakeholders")
        .insert({
          organization_id: ctx.orgId,
          name: r.stakeholder.trim(),
          kind: STAKE_KINDS.has(r.kind) ? r.kind : "person",
          created_by: ctx.userId,
        })
        .select("id")
        .maybeSingle();
      stakeholderId = ins?.id;
      if (stakeholderId) byName.set(key, stakeholderId);
    }
    if (!stakeholderId) continue;
    await supabase.from("equity_holdings").insert({
      organization_id: ctx.orgId,
      entity_id: entityId,
      stakeholder_id: stakeholderId,
      ownership_pct: typeof r.ownership_pct === "number" ? r.ownership_pct : null,
      units: typeof r.units === "number" ? r.units : null,
      created_by: ctx.userId,
    });
    created += 1;
  }

  revalidatePath(ENTITY);
  return { created };
}

// Import cap-table holdings parsed from a CSV. Mirrors draftOwnershipWithEarn:
// resolves/creates stakeholders by name (case-insensitive within the org),
// resolves each row's share class by name within the entity (left null when the
// class is blank or unmatched — we don't create classes on import), and inserts
// equity_holdings. Rows come pre-parsed from the client (see lib/holdings-csv).
export async function importHoldingsCsv(
  entityId: string,
  rows: ParsedHoldingRow[],
): Promise<{ created: number } | { error: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No rows to import." };

  const supabase = await createServerClient();
  const { data: ent } = await supabase
    .from("entities")
    .select("*")
    .eq("id", entityId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const entity = ent as Entity | null;
  if (!entity) return { error: "Entity not found" };

  // Resolve/insert stakeholders by name (case-insensitive within the org).
  const { data: existingStake } = await supabase
    .from("stakeholders")
    .select("id,name")
    .eq("organization_id", ctx.orgId);
  const stakeByName = new Map((existingStake ?? []).map((s) => [s.name.toLowerCase(), s.id]));

  // Resolve share classes by name within this entity (case-insensitive).
  const { data: existingClasses } = await supabase
    .from("share_classes")
    .select("id,name")
    .eq("organization_id", ctx.orgId)
    .eq("entity_id", entityId);
  const classByName = new Map((existingClasses ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  let created = 0;
  for (const r of rows) {
    const name = (r.holder ?? "").trim();
    const key = name.toLowerCase();
    if (!key) continue;

    let stakeholderId = stakeByName.get(key);
    if (!stakeholderId) {
      const { data: ins } = await supabase
        .from("stakeholders")
        .insert({
          organization_id: ctx.orgId,
          name,
          kind: "person",
          created_by: ctx.userId,
        })
        .select("id")
        .maybeSingle();
      stakeholderId = ins?.id;
      if (stakeholderId) stakeByName.set(key, stakeholderId);
    }
    if (!stakeholderId) continue;

    const className = (r.className ?? "").trim();
    const shareClassId = className ? classByName.get(className.toLowerCase()) ?? null : null;

    await supabase.from("equity_holdings").insert({
      organization_id: ctx.orgId,
      entity_id: entityId,
      stakeholder_id: stakeholderId,
      share_class_id: shareClassId,
      units: typeof r.units === "number" ? r.units : null,
      ownership_pct: typeof r.ownershipPct === "number" ? r.ownershipPct : null,
      invested_amount: typeof r.invested === "number" ? r.invested : null,
      created_by: ctx.userId,
    });
    created += 1;
  }

  revalidatePath(ENTITY);
  return { created };
}
