"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { normalizeAvatarConfig, type AvatarConfig } from "@/lib/office/avatarConfig";
import { resolvePortraitGenerator } from "@/lib/office/portraitGen";
import { portraitPromptFor } from "@/lib/office/portraitPrompt";

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
// Flow: build a persona-style prompt from the (re-normalized) config → ask
// Claude to draw the character as an SVG, validated by rejection → encode it as
// a `data:` URI and stash that on the member's office_member_prefs row. The
// `data:` URI is rendered only via <img>, which blocks SVG scripting and
// external fetches, and browsers refuse to open `data:` documents top-level —
// so there is no navigable, script-capable URL anywhere. Degrades cleanly: when
// no Anthropic key is configured, returns a friendly error instead of throwing,
// so the button can explain that the feature is off.
export async function generateAvatarPortrait(
  input: AvatarConfig,
): Promise<{ error?: string; url?: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };
  if (!ctx.orgId) return { error: "No active organization" };

  const generator = resolvePortraitGenerator();
  if (!generator) {
    return { error: "AI portraits aren't configured for this deployment yet." };
  }

  const config = normalizeAvatarConfig(input);
  const prompt = portraitPromptFor(config);

  let svg: string;
  try {
    const portrait = await generator.generate(prompt, AbortSignal.timeout(120_000));
    svg = portrait.svg;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown error";
    return { error: `Couldn't generate a portrait. ${detail}`.slice(0, 240) };
  }

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

  const supabase = await createServerClient();
  const { error: saveError } = await supabase
    .from("office_member_prefs")
    .upsert(
      {
        organization_id: ctx.orgId,
        principal_id: ctx.userId,
        portrait_url: dataUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,principal_id" },
    );
  if (saveError) return { error: saveError.message };

  revalidatePath("/office/builder");
  revalidatePath("/office");
  return { url: dataUrl };
}
