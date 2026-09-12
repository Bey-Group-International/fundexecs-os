"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  MAX_AVATAR_BYTES,
  MEMBER_AVATAR_BUCKET,
  avatarObjectPath,
  sniffImageType,
} from "@/lib/avatar";
import type { MemberRole } from "@/lib/supabase/database.types";

// Member photo upload, shared by Build > Team, /settings, and onboarding so all
// three agree on where a photo lives and what counts as one.
//
// A member always manages their own photo. An owner/admin may also manage any
// member's photo in their own org, so a firm can put a face on a teammate who
// has not logged in yet.

// Surfaces that render a member photo.
const REVALIDATE_PATHS = ["/build/team", "/settings"];

function isAdmin(role: MemberRole | null): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Resolve who this call is allowed to act on. Returns the target principal id,
 * or an error when the caller may not touch that member.
 *
 * `principal_id` is optional: absent (or equal to the caller) means "my own
 * photo", which every member may do. Anything else requires admin rights AND
 * that the target is actually a member of the caller's org -- an admin of org A
 * must not be able to rewrite a principal in org B by id.
 */
async function resolveTarget(
  formData: FormData,
): Promise<{ orgId: string; targetId: string; isSelf: boolean } | { error: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "No active organization." };

  const requested = String(formData.get("principal_id") ?? "").trim();
  if (!requested || requested === ctx.userId) {
    return { orgId: ctx.orgId, targetId: ctx.userId, isSelf: true };
  }

  if (!isAdmin(ctx.role)) {
    return { error: "Only admins and owners can change another member's photo." };
  }

  const supabase = await createServerClient();
  const { data: member } = await supabase
    .from("organization_members")
    .select("principal_id")
    .eq("organization_id", ctx.orgId)
    .eq("principal_id", requested)
    .maybeSingle();
  if (!member) return { error: "That teammate is not in this organization." };

  return { orgId: ctx.orgId, targetId: requested, isSelf: false };
}

// Writing another principal's row needs the service client -- `principals`
// RLS is self-only (principals_update_self, 0010_rls). Only ever reached after
// the admin guard in resolveTarget.
async function writeAvatarUrl(targetId: string, isSelf: boolean, value: string | null) {
  const db = isSelf ? await createServerClient() : createServiceClient();
  return db
    .from("principals")
    .update({ avatar_url: value, updated_at: new Date().toISOString() })
    .eq("id", targetId);
}

/**
 * Store an uploaded photo and point the member's row at it.
 *
 * Expects `file` (an image) and an optional `principal_id`. The client
 * re-encodes to JPEG before sending, so the bytes are checked by magic number
 * rather than by the browser-supplied `type`, which a crafted request controls.
 */
export async function uploadAvatar(formData: FormData): Promise<{ error?: string; url?: string }> {
  const target = await resolveTarget(formData);
  if ("error" in target) return { error: target.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  if (file.size > MAX_AVATAR_BYTES) return { error: "That image is too large. Try a smaller file." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (sniffed !== "image/jpeg") {
    // The client always sends JPEG. Anything else is a crafted request or a
    // browser whose canvas encode silently produced something unexpected.
    return { error: "That file isn't a usable image. Upload a PNG or JPEG photo." };
  }

  const supabase = await createServerClient();
  const path = avatarObjectPath(target.orgId, target.targetId);

  // Deterministic path + upsert: one object per member, replaced in place, so a
  // re-upload can never leave an orphan behind.
  const { error: uploadError } = await supabase.storage
    .from(MEMBER_AVATAR_BUCKET)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) {
    console.error("[uploadAvatar]", uploadError.message);
    return { error: "Could not upload that photo. Please try again." };
  }

  const { data: publicUrl } = supabase.storage.from(MEMBER_AVATAR_BUCKET).getPublicUrl(path);
  const url = publicUrl?.publicUrl ?? null;
  if (!url) return { error: "Could not upload that photo. Please try again." };

  const { error: dbError } = await writeAvatarUrl(target.targetId, target.isSelf, url);
  if (dbError) {
    console.error("[uploadAvatar]", dbError.message);
    return { error: "Photo uploaded, but the profile could not be saved. Please try again." };
  }

  for (const p of REVALIDATE_PATHS) revalidatePath(p);
  return { url };
}

/**
 * Drop a member's photo -- clears the row and deletes the stored object so we
 * are not holding a picture nobody asked us to keep.
 */
export async function removeAvatar(formData: FormData): Promise<{ error?: string }> {
  const target = await resolveTarget(formData);
  if ("error" in target) return { error: target.error };

  const { error: dbError } = await writeAvatarUrl(target.targetId, target.isSelf, null);
  if (dbError) {
    console.error("[removeAvatar]", dbError.message);
    return { error: "Could not remove that photo. Please try again." };
  }

  // Best-effort: the row no longer points at the object, so a failed delete
  // leaves storage litter but never a stale photo on screen.
  const supabase = await createServerClient();
  const { error: storageError } = await supabase.storage
    .from(MEMBER_AVATAR_BUCKET)
    .remove([avatarObjectPath(target.orgId, target.targetId)]);
  if (storageError) console.warn("[removeAvatar] storage", storageError.message);

  for (const p of REVALIDATE_PATHS) revalidatePath(p);
  return {};
}
