// lib/network-field-defs.server.ts — reading an org's column definitions.
//
// Split from lib/network-fields.ts so the pure validation rules stay importable
// from a client component without dragging a Supabase client into the bundle.

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapFieldDef, type FieldDef, type FieldEntity } from "@/lib/network-fields";

const FIELD_DEF_SELECT =
  "id, entity, field_key, label, field_type, options, help_text, is_required, position";

/**
 * The org's active column definitions for one entity, in display order.
 *
 * Archived definitions are excluded: a retired column should stop appearing in
 * the UI and stop accepting writes, while the values already recorded against
 * it stay in the jsonb untouched.
 *
 * Never throws — a workspace whose custom columns cannot be read should still
 * render its built-in ones.
 */
export async function loadFieldDefs(
  client: SupabaseClient,
  orgId: string,
  entity: FieldEntity,
): Promise<FieldDef[]> {
  try {
    const { data, error } = await client
      .from("network_field_defs")
      .select(FIELD_DEF_SELECT)
      .eq("organization_id", orgId)
      .eq("entity", entity)
      .is("archived_at", null)
      .order("position", { ascending: true })
      .limit(100);
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(mapFieldDef);
  } catch (err) {
    console.warn("[network-field-defs] read failed", err);
    return [];
  }
}

/**
 * The strict variant, for WRITE paths.
 *
 * loadFieldDefs swallows a failed read and returns [] so a render still works.
 * On a write that is dangerous: applyCustomPatch skips every key with no
 * matching definition and still reports success, so a transient failure here
 * would make the route accept an edit, discard every custom value in it, and
 * answer 200. The operator sees the edit land and the value is simply gone.
 *
 * So validation reads through this instead, and a failed read becomes a 5xx.
 */
export async function loadFieldDefsStrict(
  client: SupabaseClient,
  orgId: string,
  entity: FieldEntity,
): Promise<FieldDef[]> {
  const { data, error } = await client
    .from("network_field_defs")
    .select(FIELD_DEF_SELECT)
    .eq("organization_id", orgId)
    .eq("entity", entity)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapFieldDef);
}

/** Both entities in one round trip, for pages that show contacts and deals. */
export async function loadAllFieldDefs(
  client: SupabaseClient,
  orgId: string,
): Promise<{ contact: FieldDef[]; opportunity: FieldDef[] }> {
  try {
    const { data, error } = await client
      .from("network_field_defs")
      .select(FIELD_DEF_SELECT)
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("position", { ascending: true })
      .limit(200);
    if (error) throw error;

    const defs = ((data ?? []) as Record<string, unknown>[]).map(mapFieldDef);
    return {
      contact: defs.filter((d) => d.entity === "contact"),
      opportunity: defs.filter((d) => d.entity === "opportunity"),
    };
  } catch (err) {
    console.warn("[network-field-defs] read failed", err);
    return { contact: [], opportunity: [] };
  }
}
