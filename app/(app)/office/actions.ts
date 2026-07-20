"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  DEFAULT_LAYOUT,
  parseLayout,
  serializeLayout,
  type OfficeLayoutData,
} from "@/lib/office/layoutStore";

// The persisted Virtual Office layout lives one-row-per-org in `office_layouts`
// (jsonb). Reads coerce whatever is stored through `parseLayout` so a stale or
// hand-edited row can never crash a render; writes re-check auth/org server-side
// and `serializeLayout` before upserting — the client payload is never trusted.

// The table is new, so (like lib/skills/store.ts) it is reached through a narrow
// unknown-cast until the generated DB types are regenerated.
type LoosePromise<T> = Promise<{ data: T; error: { message: string } | null }>;
interface LooseSelect {
  eq: (col: string, val: string) => { maybeSingle: () => LoosePromise<unknown> };
}
type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => LooseSelect;
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => LoosePromise<unknown>;
  };
};

/**
 * Load an org's saved office layout, falling back to the built-in default map
 * when there is no row (org has never customized) or Supabase is unconfigured.
 * Always returns a safe, validated layout.
 */
export async function loadOfficeLayout(orgId: string): Promise<OfficeLayoutData> {
  if (!orgId || !hasSupabaseServerEnv()) return DEFAULT_LAYOUT;

  const supabase = (await createServerClient()) as unknown as LooseClient;
  const { data } = await supabase
    .from("office_layouts")
    .select("layout")
    .eq("organization_id", orgId)
    .maybeSingle();

  const row = data as { layout?: unknown } | null;
  if (!row?.layout) return DEFAULT_LAYOUT;
  return parseLayout(row.layout);
}

/**
 * Persist an org's office layout (upsert, one row per org). Re-derives the org
 * from the session rather than trusting the passed `orgId`, and normalizes the
 * payload before writing so only valid geometry is stored.
 */
export async function saveOfficeLayout(
  orgId: string,
  data: OfficeLayoutData,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not authenticated" };
  // Never trust the client's orgId — write against the session's own org.
  if (orgId && orgId !== ctx.orgId) {
    return { ok: false, error: "Organization mismatch" };
  }

  const layout = serializeLayout(data);

  const supabase = (await createServerClient()) as unknown as LooseClient;
  const { error } = await supabase.from("office_layouts").upsert(
    {
      organization_id: ctx.orgId,
      layout,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath("/office");
  return { ok: true };
}
