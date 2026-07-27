"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeAvatarConfig, type AvatarConfig } from "@/lib/office/avatarConfig";
import { resolveImageGenerator } from "@/lib/office/imagegen";
import { portraitPromptFor } from "@/lib/office/portraitPrompt";

const PORTRAIT_BUCKET = "office-portraits";

// Persist the member's Virtual Office character onto their own
// `office_member_prefs` row (avatar jsonb column, reserved for exactly this by
// migration 20260720140000). The input is always re-normalized server-side, so
// a tampered client payload can never store an out-of-catalog value. RLS scopes
// the write to `principal_id = auth.uid()` within an org the caller belongs to,
// so a member can only ever write their own character.
export async function saveAvatarConfig(
  input: AvatarConfig,
): Promise<{ error?: string; config?: AvatarConfig }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };
  if (!ctx.orgId) return { error: "No active organization" };

  const config = normalizeAvatarConfig(input);
  const supabase = await createServerClient();

  const { error } = await supabase
    .from("office_member_prefs")
    .upsert(
      {
        organization_id: ctx.orgId,
        principal_id: ctx.userId,
        avatar: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/office/builder");
  revalidatePath("/office");
  return { config };
}

// Generate a premium AI portrait DERIVED from the member's character and cache
// it. The portrait is the "hero" rendering shown in the Studio and on the
// roster card; the procedural sprite (avatarSprite.ts) still walks the floor.
//
// Flow: build a persona-style prompt from the (re-normalized) config → call the
// configured image provider → upload the PNG to the public office-portraits
// bucket at `${orgId}/${principalId}.png` (RLS pins that path to the caller) →
// stash its public URL on the member's office_member_prefs row. Degrades
// cleanly: when no provider is configured, returns a friendly error instead of
// throwing, so the button can explain that the feature is off.
export async function generateAvatarPortrait(
  input: AvatarConfig,
): Promise<{ error?: string; url?: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };
  if (!ctx.orgId) return { error: "No active organization" };

  const generator = resolveImageGenerator();
  if (!generator) {
    return { error: "AI portraits aren't configured for this deployment yet." };
  }

  const config = normalizeAvatarConfig(input);
  const prompt = portraitPromptFor(config);

  let png: Buffer;
  try {
    const image = await generator.generate(prompt, {
      size: "1024x1024",
      background: "transparent",
      signal: AbortSignal.timeout(90_000),
    });
    png = Buffer.from(image.base64, "base64");
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return { error: `Couldn't generate a portrait. ${detail}`.slice(0, 240) };
  }

  const supabase = await createServerClient();
  const path = `${ctx.orgId}/${ctx.userId}.png`;

  const { error: uploadError } = await supabase.storage
    .from(PORTRAIT_BUCKET)
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (uploadError) return { error: uploadError.message };

  const {
    data: { publicUrl },
  } = supabase.storage.from(PORTRAIT_BUCKET).getPublicUrl(path);

  // The filename is stable (one portrait per member), so bust the CDN/browser
  // cache with the upload time; the stored value is versioned the same way.
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;

  const { error: saveError } = await supabase
    .from("office_member_prefs")
    .upsert(
      {
        organization_id: ctx.orgId,
        principal_id: ctx.userId,
        portrait_url: versionedUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );
  if (saveError) return { error: saveError.message };

  revalidatePath("/office/builder");
  revalidatePath("/office");
  return { url: versionedUrl };
}
