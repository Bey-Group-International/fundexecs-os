"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { ActionKind } from "@/lib/gates";
import { TIER_2_ACTIONS } from "./tier2-actions";

const TIER_2_SET = new Set<ActionKind>(TIER_2_ACTIONS.map((a) => a.kind));

// Create a mandate and make it the org's active standing delegation. Only
// Tier-2 actions are accepted — anything else is dropped so a mandate can never
// claim to authorize Tier 1 (already free) or Tier 3 (never delegable). The new
// mandate becomes active and any previously active mandate is stood down, so
// the active-mandate lookup always resolves to exactly one row.
export async function createMandate(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "Not authenticated" };

  const name = String(formData.get("name") ?? "").trim();
  const goal = String(formData.get("goal") ?? "").trim();
  if (!name) return { error: "Name is required" };

  const autoApprove = formData
    .getAll("auto_approve")
    .map((v) => String(v) as ActionKind)
    .filter((v) => TIER_2_SET.has(v));

  const supabase = await createServerClient();

  // Stand down any currently active mandate first — one active delegation at a time.
  await supabase
    .from("mandates")
    .update({ is_active: false })
    .eq("organization_id", ctx.orgId)
    .eq("is_active", true);

  const { error } = await supabase.from("mandates").insert({
    organization_id: ctx.orgId,
    name,
    goal: goal || null,
    auto_approve: autoApprove,
    // Capped at 2 in the DB; Tier 3 is never delegable.
    autonomy_ceiling: 2,
    is_active: true,
    created_by: ctx.userId,
  });

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

// Toggle the org's ecosystem discoverability. When on, a matching newcomer's
// profile can surface to this org and Earn delivers it match alerts; when off,
// the org goes dark — no broadcast out, no match alerts in. Admin-gated by RLS
// (organizations_update → is_org_admin), so a non-admin submit is a silent no-op.
export async function setDiscoverable(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const next = String(formData.get("discoverable") ?? "") === "true";
  const supabase = await createServerClient();
  const { error } = await supabase.from("organizations").update({ discoverable: next }).eq("id", ctx.orgId);
  if (error) { console.error("[setDiscoverable]", error.message); return; }
  revalidatePath("/settings");
}

// Set the firm-wide marketplace booking link. Buyers see a "Book a meeting"
// button on any of the firm's listings that don't carry their own link.
// Accepts any well-formed https scheduling URL; blank/invalid clears it. Admin-
// gated by RLS (organizations_update → is_org_admin), so a non-admin submit is a
// silent no-op.
export async function setFirmBookingUrl(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const raw = String(formData.get("booking_url") ?? "").trim();
  let bookingUrl: string | null = null;
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:") bookingUrl = u.toString();
    } catch {
      bookingUrl = null;
    }
  }
  const supabase = await createServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({ booking_url: bookingUrl })
    .eq("id", ctx.orgId);
  if (error) { console.error("[setFirmBookingUrl]", error.message); return; }
  revalidatePath("/settings");
  revalidatePath("/marketplace");
}

// Stand down the active mandate — every Tier-2 action falls back to operator
// sign-off until a new mandate is activated.
export async function deactivateMandate(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createServerClient();
  const { error } = await supabase
    .from("mandates")
    .update({ is_active: false })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  if (error) { console.error("[deactivateMandate]", error.message); return; }
  revalidatePath("/settings");
}

export async function saveUserProfile(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not authenticated" };

  const supabase = await createServerClient();
  const str = (key: string) => String(formData.get(key) ?? "").trim() || null;

  const { error } = await supabase
    .from("principals")
    .update({
      full_name: str("full_name"),
      title: str("title"),
      phone: str("phone"),
      avatar_url: str("avatar_url"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.userId);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

export async function changePassword(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createServerClient();
  const password = String(formData.get("password") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (!password) return { error: "New password is required" };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  if (password !== confirm) return { error: "Passwords do not match" };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return {};
}
