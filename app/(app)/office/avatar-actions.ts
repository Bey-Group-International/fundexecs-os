"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  avatarForId,
  parseAvatar,
  type AvatarConfig,
} from "@/lib/office/avatarConfig";

// A member's customized pixel-art avatar persists one-row-per-member in
// `office_member_prefs.avatar` (jsonb, added 20260720140000). Reads coerce
// whatever is stored through `parseAvatar` so a stale or hand-edited row can
// never crash a render, falling back to the deterministic `avatarForId` when
// there is no row; writes re-check auth server-side and re-sanitize the payload
// before upserting — the client config is never trusted.

// `office_member_prefs` isn't in the generated DB types yet, so (like
// actions.ts / lib/skills/store.ts) it is reached through a narrow unknown-cast.
type LoosePromise<T> = Promise<{ data: T; error: { message: string } | null }>;
interface LooseSelect {
  eq: (col: string, val: string) => LooseSelect & {
    maybeSingle: () => LoosePromise<unknown>;
  };
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
 * Load the signed-in member's saved avatar for an org, falling back to the
 * deterministic `avatarForId` when they have no row, Supabase is unconfigured,
 * or anything goes wrong. Always returns a valid config; never throws.
 */
export async function loadMyAvatar(orgId: string): Promise<AvatarConfig> {
  const ctx = await getSessionContext();
  const userId = ctx?.userId;
  if (!userId) return avatarForId("anon");
  if (!orgId || !hasSupabaseServerEnv()) return avatarForId(userId);

  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;
    const { data, error } = await supabase
      .from("office_member_prefs")
      .select("avatar")
      .eq("organization_id", orgId)
      .eq("principal_id", userId)
      .maybeSingle();

    if (error) return avatarForId(userId);
    const row = data as { avatar?: unknown } | null;
    if (!row?.avatar) return avatarForId(userId);
    return parseAvatar(row.avatar, userId);
  } catch {
    return avatarForId(userId);
  }
}

/**
 * Persist the signed-in member's avatar (upsert, one row per member). Re-derives
 * the member/org from the session rather than trusting the passed `orgId`, and
 * re-sanitizes the config before writing so only a valid avatar is stored.
 */
export async function saveMyAvatar(
  orgId: string,
  config: AvatarConfig,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId || !ctx.userId) return { ok: false, error: "Not authenticated" };
  // Never trust the client's orgId — write against the session's own org.
  if (orgId && orgId !== ctx.orgId) {
    return { ok: false, error: "Organization mismatch" };
  }
  if (!hasSupabaseServerEnv()) return { ok: false, error: "Supabase not configured" };

  const avatar = parseAvatar(config, ctx.userId);

  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;
    const { error } = await supabase.from("office_member_prefs").upsert(
      {
        organization_id: ctx.orgId,
        principal_id: ctx.userId,
        avatar,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );

    if (error) return { ok: false, error: error.message };
    revalidatePath("/office");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}
