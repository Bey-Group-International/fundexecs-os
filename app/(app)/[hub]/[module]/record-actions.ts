"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { isManagedTable, type RecordActionResult } from "@/lib/managed-tables";

function revalidationPath(hub: string, module: string): string {
  return module ? `/${hub}/${module}` : `/${hub}`;
}

// Shared update path. RLS scopes the row to the caller's org and enforces writer
// access; the literal `as "investors"` keeps the typed client happy while the
// allow-list guarantees the runtime value is a real managed table.
async function patch(
  hub: string,
  module: string,
  table: string,
  id: string,
  values: Record<string, unknown>,
): Promise<RecordActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!isManagedTable(table)) return { ok: false, error: "Unknown table." };
  if (!id) return { ok: false, error: "Missing record id." };

  const supabase = createServerClient();
  const { error } = await supabase
    .from(table as "investors")
    .update(values as never)
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(revalidationPath(hub, module));
  return { ok: true };
}

export async function verifyRecord(
  hub: string,
  module: string,
  table: string,
  id: string,
  note?: string,
): Promise<RecordActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  return patch(hub, module, table, id, {
    verification_status: "verified",
    verified_at: new Date().toISOString(),
    verified_by: auth.ctx.userId,
    ...(note && note.trim() ? { verification_note: note.trim().slice(0, 500) } : {}),
  });
}

export async function unverifyRecord(
  hub: string,
  module: string,
  table: string,
  id: string,
): Promise<RecordActionResult> {
  return patch(hub, module, table, id, {
    verification_status: "unverified",
    verified_at: null,
    verified_by: null,
  });
}

export async function archiveRecord(
  hub: string,
  module: string,
  table: string,
  id: string,
): Promise<RecordActionResult> {
  return patch(hub, module, table, id, { archived_at: new Date().toISOString() });
}

export async function restoreRecord(
  hub: string,
  module: string,
  table: string,
  id: string,
): Promise<RecordActionResult> {
  return patch(hub, module, table, id, { archived_at: null });
}

// Permanent, non-reversible removal — behind a confirm in the UI.
export async function deleteRecord(
  hub: string,
  module: string,
  table: string,
  id: string,
): Promise<RecordActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  if (!isManagedTable(table)) return { ok: false, error: "Unknown table." };
  if (!id) return { ok: false, error: "Missing record id." };

  const supabase = createServerClient();
  const { error } = await supabase.from(table as "investors").delete().eq("organization_id", auth.ctx.orgId).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(revalidationPath(hub, module));
  return { ok: true };
}
