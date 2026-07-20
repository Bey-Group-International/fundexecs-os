"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { avatarForId, parseAvatar } from "@/lib/office/avatarConfig";
import { portraitPrompt } from "@/lib/office/portraitPrompt";
import { getImageProvider } from "@/lib/office/imageProvider";

// Premium AI portraits, DERIVED from each member's saved avatar config, cached
// in Supabase Storage and referenced from `office_member_prefs.portrait_url`
// (added 20260720150000). Provider-agnostic (Replicate by default) and
// gracefully degrading: with no image provider key and no storage bucket, the
// happy path never throws — it returns `{ url: null, fallback: true }` so the
// UI shows the procedural monogram instead.

const BUCKET = "office-portraits";

// Like actions.ts / avatar-actions.ts, `office_member_prefs` and Storage aren't
// in the generated DB types yet, so they're reached through a narrow
// unknown-cast until the types are regenerated.
type LoosePromise<T> = Promise<{ data: T; error: { message: string } | null }>;
interface LooseSelect {
  eq: (col: string, val: string) => LooseSelect & {
    maybeSingle: () => LoosePromise<unknown>;
  };
}
interface LooseBucket {
  upload: (
    path: string,
    body: Uint8Array,
    opts: { upsert: boolean; contentType: string },
  ) => LoosePromise<unknown>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
  remove: (paths: string[]) => LoosePromise<unknown>;
}
type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => LooseSelect;
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ) => LoosePromise<unknown>;
  };
  storage: { from: (bucket: string) => LooseBucket };
};

/**
 * Generate (or regenerate) the signed-in member's premium AI portrait from
 * their saved avatar config, cache it in Supabase Storage, and persist the
 * public URL. Degrades gracefully: with no configured image provider (or on any
 * failure) it returns `{ url: null, fallback: true }` and never throws.
 */
export async function generateMyPortrait(
  orgId: string,
): Promise<{ url: string | null; fallback: boolean; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId || !ctx.userId) {
    return { url: null, fallback: true, error: "Not authenticated" };
  }
  // Never trust the client's orgId — operate against the session's own org.
  if (orgId && orgId !== ctx.orgId) {
    return { url: null, fallback: true, error: "Organization mismatch" };
  }
  if (!hasSupabaseServerEnv()) {
    return { url: null, fallback: true, error: "Supabase not configured" };
  }

  const principalId = ctx.userId;

  // No image provider configured → deterministic, non-throwing fallback signal.
  const provider = getImageProvider();
  if (!provider) return { url: null, fallback: true };

  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;

    // Load the member's saved avatar (else the deterministic default) and turn
    // it into the portrait prompt.
    const { data: prefRow } = await supabase
      .from("office_member_prefs")
      .select("avatar")
      .eq("organization_id", ctx.orgId)
      .eq("principal_id", principalId)
      .maybeSingle();
    const savedAvatar = (prefRow as { avatar?: unknown } | null)?.avatar;
    const config = savedAvatar
      ? parseAvatar(savedAvatar, principalId)
      : avatarForId(principalId);
    const prompt = portraitPrompt(config);

    // Generate bytes (provider never throws; returns null on any failure).
    const bytes = await provider.generate(prompt);
    if (!bytes) return { url: null, fallback: true, error: "Generation failed" };

    // Cache in Storage under the member's own org/principal prefix.
    const path = `${ctx.orgId}/${principalId}.png`;
    const bucket = supabase.storage.from(BUCKET);
    const { error: uploadError } = await bucket.upload(path, bytes, {
      upsert: true,
      contentType: "image/png",
    });
    if (uploadError) {
      return { url: null, fallback: true, error: uploadError.message };
    }

    const { data: publicData } = bucket.getPublicUrl(path);
    // Cache-bust so a regenerated portrait replaces a stale cached image.
    const url = `${publicData.publicUrl}?v=${Date.now()}`;

    // Persist the public URL onto the member's prefs row.
    const { error: saveError } = await supabase.from("office_member_prefs").upsert(
      {
        organization_id: ctx.orgId,
        principal_id: principalId,
        portrait_url: url,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );
    if (saveError) return { url: null, fallback: true, error: saveError.message };

    revalidatePath("/office");
    return { url, fallback: false };
  } catch (err) {
    return {
      url: null,
      fallback: true,
      error: err instanceof Error ? err.message : "Portrait generation failed",
    };
  }
}

/**
 * Read the signed-in member's cached portrait URL for an org, or null when
 * there is none, Supabase is unconfigured, or anything goes wrong.
 */
export async function loadMyPortrait(orgId: string): Promise<string | null> {
  const ctx = await getSessionContext();
  const userId = ctx?.userId;
  if (!userId || !orgId || !hasSupabaseServerEnv()) return null;

  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;
    const { data, error } = await supabase
      .from("office_member_prefs")
      .select("portrait_url")
      .eq("organization_id", orgId)
      .eq("principal_id", userId)
      .maybeSingle();
    if (error) return null;
    const row = data as { portrait_url?: unknown } | null;
    return typeof row?.portrait_url === "string" ? row.portrait_url : null;
  } catch {
    return null;
  }
}

/**
 * Clear the signed-in member's portrait: null the column and best-effort remove
 * the cached Storage object. Never throws.
 */
export async function clearMyPortrait(orgId: string): Promise<{ ok: boolean }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId || !ctx.userId) return { ok: false };
  if (orgId && orgId !== ctx.orgId) return { ok: false };
  if (!hasSupabaseServerEnv()) return { ok: false };

  const principalId = ctx.userId;
  try {
    const supabase = (await createServerClient()) as unknown as LooseClient;
    const { error } = await supabase.from("office_member_prefs").upsert(
      {
        organization_id: ctx.orgId,
        principal_id: principalId,
        portrait_url: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );
    if (error) return { ok: false };

    // Best-effort object removal — failure here doesn't undo the column clear.
    try {
      await supabase.storage.from(BUCKET).remove([`${ctx.orgId}/${principalId}.png`]);
    } catch {
      // ignore — the column is already cleared, which is what the UI reads.
    }

    revalidatePath("/office");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
