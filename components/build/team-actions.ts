"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import type { MemberRole } from "@/lib/supabase/database.types";

const TEAM = "/build/team";

const ROLES: MemberRole[] = ["owner", "admin", "member"];

function isAdmin(role: MemberRole | null): boolean {
  return role === "owner" || role === "admin";
}

function parseRole(raw: FormDataEntryValue | null): MemberRole | null {
  const r = String(raw ?? "").trim();
  return (ROLES as string[]).includes(r) ? (r as MemberRole) : null;
}

// Count current owners in the org. Uses the service client so the check is
// reliable regardless of the caller's row-level visibility, but it only ever
// reads — every mutation below is still gated on the admin/owner guard.
async function countOwners(orgId: string): Promise<number> {
  const svc = createServiceClient();
  const { count } = await svc
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("role", "owner");
  return count ?? 0;
}

// 1. Update the CALLER's own principal row. RLS allows a principal to UPDATE
// only their own row (id = auth.uid()), so this is safe with the RLS client.
export async function updateMyProfile(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const supabase = createServerClient();
  await supabase
    .from("principals")
    .update({
      full_name: String(formData.get("full_name") ?? "").trim() || null,
      title: String(formData.get("title") ?? "").trim() || null,
      avatar_url: String(formData.get("avatar_url") ?? "").trim() || null,
    })
    .eq("id", ctx.userId);

  revalidatePath(TEAM);
}

// 2. Change a member's role. Admin/owner only. Cannot demote the last owner.
export async function changeMemberRole(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  if (!isAdmin(ctx.role)) return;

  const memberId = String(formData.get("memberId") ?? "").trim();
  const role = parseRole(formData.get("role"));
  if (!memberId || !role) return;

  const supabase = createServerClient();

  // Guard: don't strip the last owner of their owner role.
  if (role !== "owner") {
    const { data: target } = await supabase
      .from("organization_members")
      .select("role")
      .eq("id", memberId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (target?.role === "owner" && (await countOwners(ctx.orgId)) <= 1) return;
  }

  await supabase
    .from("organization_members")
    .update({ role })
    .eq("id", memberId)
    .eq("organization_id", ctx.orgId);

  revalidatePath(TEAM);
}

// 3. Remove a member. Admin/owner only. Cannot remove self or the last owner.
export async function removeMember(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  if (!isAdmin(ctx.role)) return;

  const memberId = String(formData.get("memberId") ?? "").trim();
  if (!memberId) return;

  const supabase = createServerClient();

  const { data: target } = await supabase
    .from("organization_members")
    .select("principal_id, role")
    .eq("id", memberId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!target) return;

  // Refuse to remove yourself.
  if (target.principal_id === ctx.userId) return;
  // Refuse to remove the last owner.
  if (target.role === "owner" && (await countOwners(ctx.orgId)) <= 1) return;

  await supabase
    .from("organization_members")
    .delete()
    .eq("id", memberId)
    .eq("organization_id", ctx.orgId);

  revalidatePath(TEAM);
}

// 4. Invite (add) an existing FundExecs user to the org by email. Admin/owner
// only. principals are 1:1 with auth.users, so only existing users can join.
export async function inviteMember(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "No active organization." };
  // Admin guard MUST pass before we touch the service client.
  if (!isAdmin(ctx.role))
    return { error: "Only admins and owners can invite members." };

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) return { error: "Enter an email address." };
  const role = parseRole(formData.get("role")) ?? "member";

  // Cross-org principal lookup needs the service client (RLS would hide
  // principals outside the caller's org). Only reached after the admin guard.
  const svc = createServiceClient();
  const { data: principal } = await svc
    .from("principals")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!principal) {
    return {
      error:
        "No FundExecs account uses that email yet. Ask them to sign up first.",
    };
  }

  // Avoid the unique-constraint round-trip when we can, and handle the race.
  const { data: existing } = await svc
    .from("organization_members")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("principal_id", principal.id)
    .maybeSingle();
  if (existing) {
    return { error: "That person is already a member of this organization." };
  }

  const { error } = await svc.from("organization_members").insert({
    organization_id: ctx.orgId,
    principal_id: principal.id,
    role,
  });

  if (error) {
    // 23505 = unique_violation (already a member, lost the race above).
    if (error.code === "23505") {
      return { error: "That person is already a member of this organization." };
    }
    return { error: "Could not add that member. Please try again." };
  }

  revalidatePath(TEAM);
  return {};
}
