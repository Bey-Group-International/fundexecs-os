"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

const ENTITY = "/build/entity";

const text = (raw: FormDataEntryValue | null): string | null => {
  const v = String(raw ?? "").trim();
  return v === "" ? null : v;
};

const ENTITY_TYPES = new Set(["gp", "management_co", "fund", "spv", "holdco", "other"]);

// Sensible default share classes per vehicle type. The kinds map onto the
// share_classes.kind enum (migration 0036).
function defaultClasses(entityType: string): { name: string; kind: string }[] {
  switch (entityType) {
    case "fund":
    case "spv":
      return [
        { name: "LP Interest", kind: "lp_interest" },
        { name: "GP Interest", kind: "gp_interest" },
      ];
    case "gp":
    case "management_co":
      return [{ name: "Membership", kind: "membership" }];
    default:
      return [{ name: "Common", kind: "common" }];
  }
}

// Form a new vehicle (entity) and, optionally, seed its default share classes.
export async function formVehicle(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const rawType = String(formData.get("entity_type") ?? "spv").trim();
  const entity_type = ENTITY_TYPES.has(rawType) ? rawType : "spv";

  const supabase = await createServerClient();

  const { data: inserted } = await supabase
    .from("entities")
    .insert({
      organization_id: ctx.orgId,
      name,
      entity_type,
      jurisdiction: text(formData.get("jurisdiction")),
      parent_entity_id: text(formData.get("parent_entity_id")),
      formation_date: text(formData.get("formation_date")),
      notes: text(formData.get("notes")),
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();

  const entityId = inserted?.id;

  if (entityId && formData.get("seed_classes") === "on") {
    const rows = defaultClasses(entity_type).map((c) => ({
      organization_id: ctx.orgId,
      entity_id: entityId,
      name: c.name,
      kind: c.kind,
      authorized_units: null,
    }));
    if (rows.length) await supabase.from("share_classes").insert(rows);
  }

  revalidatePath(ENTITY);
}
