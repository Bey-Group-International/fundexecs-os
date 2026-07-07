"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

// Server actions backing the Delete / Clear all controls on the Activity feed.
//
// Activity entries are one of two underlying rows: a parent workflow (a row in
// `tasks` with parent_task_id null) or an `artifacts` row. Their entry ids are
// namespaced accordingly ("task:<uuid>" / "artifact:<uuid>"), so we route the
// delete to the right table. Deletes are hard deletes — the org's schema
// cascades child tasks, task events, and produced artifacts off a parent task
// (on delete cascade), so removing the workflow removes its whole subtree.

type Result = { ok: boolean; error?: string };

/**
 * Permanently delete a single activity entry (a workflow or an artifact). The
 * entry id is the feed's namespaced id ("task:<uuid>" or "artifact:<uuid>").
 * Org-scoped and defensive — never throws to the caller.
 */
export async function deleteActivityEntry(entryId: string): Promise<Result> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

    const sep = entryId.indexOf(":");
    if (sep < 0) return { ok: false, error: "Unknown entry." };
    const kind = entryId.slice(0, sep);
    const id = entryId.slice(sep + 1);
    if (!id) return { ok: false, error: "Unknown entry." };

    const supabase = await createServerClient();

    if (kind === "task") {
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", id)
        .eq("organization_id", ctx.orgId);
      if (error) return { ok: false, error: "Could not delete." };
    } else if (kind === "artifact") {
      const { error } = await supabase
        .from("artifacts")
        .delete()
        .eq("id", id)
        .eq("organization_id", ctx.orgId);
      if (error) return { ok: false, error: "Could not delete." };
    } else {
      return { ok: false, error: "Unknown entry." };
    }

    revalidatePath("/activity");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete." };
  }
}

/**
 * Permanently clear the org's activity: delete every parent workflow (which
 * cascades its child steps, events, and produced artifacts). This empties the
 * cross-hub timeline. Org-scoped and defensive.
 */
export async function clearActivity(): Promise<Result> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

    const supabase = await createServerClient();
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null);
    if (error) return { ok: false, error: "Could not clear activity." };

    revalidatePath("/activity");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not clear activity." };
  }
}
