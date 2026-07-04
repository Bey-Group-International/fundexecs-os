"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { planSeatLimit, seatLimitReached } from "@/lib/billing";
import {
  createTeamTask,
  normalizeTeamTaskPriority,
  recordOperatorFeedback,
} from "@/lib/team-tasks";
import type { Hub, MemberRole } from "@/lib/supabase/database.types";

const TEAM = "/build/team";

const ROLES: MemberRole[] = ["owner", "admin", "member"];
const HUBS: Hub[] = ["build", "source", "run", "execute"];

function isAdmin(role: MemberRole | null): boolean {
  return role === "owner" || role === "admin";
}

function parseRole(raw: FormDataEntryValue | null): MemberRole | null {
  const r = String(raw ?? "").trim();
  return (ROLES as string[]).includes(r) ? (r as MemberRole) : null;
}

function parseHub(raw: FormDataEntryValue | null): Hub | null {
  const hub = String(raw ?? "").trim();
  return (HUBS as string[]).includes(hub) ? (hub as Hub) : null;
}

function parseDueDate(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T12:00:00.000Z`).toISOString();
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

  const supabase = await createServerClient();
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

// Assign work to a human teammate. The task appears in their Earn dock and can
// be launched with all assignment context preloaded.
export async function assignTeamTask(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "No active organization." };
  if (!isAdmin(ctx.role) && ctx.role !== "member") {
    return { error: "Only active team members can assign tasks." };
  }

  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!assignedTo) return { error: "Choose a teammate." };
  if (!title) return { error: "Add a task title." };

  const supabase = await createServerClient();
  const { data: member } = await supabase
    .from("organization_members")
    .select("principal_id")
    .eq("organization_id", ctx.orgId)
    .eq("principal_id", assignedTo)
    .maybeSingle();
  if (!member) return { error: "That teammate is not in this organization." };

  const hub = parseHub(formData.get("hub"));
  const taskModule = String(formData.get("module") ?? "").trim() || null;
  const task = await createTeamTask(supabase, {
    organizationId: ctx.orgId,
    assignedTo,
    assignedBy: ctx.userId,
    title,
    description: String(formData.get("description") ?? "").trim() || null,
    hub,
    module: taskModule,
    priority: normalizeTeamTaskPriority(String(formData.get("priority") ?? "")),
    dueAt: parseDueDate(formData.get("due_at")),
    contextSnapshot: {
      created_from: "build/team",
      assigned_by_role: ctx.role,
    },
  });
  if (!task) return { error: "Could not assign that task. Please try again." };

  await recordOperatorFeedback(supabase, [
    {
      organizationId: ctx.orgId,
      principalId: ctx.userId,
      signal: "team_task_assigned",
      subject: task.title,
      scope: hub && taskModule ? `${hub}/${taskModule}` : hub ?? "build/team",
      module: taskModule,
      teamTaskId: task.id,
      metadata: { assigned_to: assignedTo },
    },
  ]);
  revalidatePath(TEAM);
  return {};
}

// 2. Change a member's role. Admin/owner only. Cannot demote the last owner.
export async function changeMemberRole(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  if (!isAdmin(ctx.role)) return;

  const memberId = String(formData.get("memberId") ?? "").trim();
  const role = parseRole(formData.get("role"));
  if (!memberId || !role) return;

  const supabase = await createServerClient();

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

  const supabase = await createServerClient();

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

  // Seat limit: an org can only add members up to its plan's seat allotment.
  // Read the plan and current member count with the service client so the
  // check is reliable regardless of the caller's row-level visibility.
  const { data: wallet } = await svc
    .from("wallets")
    .select("plan")
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const { count: memberCount } = await svc
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.orgId);
  if (seatLimitReached(wallet?.plan, memberCount ?? 0)) {
    const limit = planSeatLimit(wallet?.plan);
    return {
      error: `Your plan includes ${limit} seat${limit === 1 ? "" : "s"}. Upgrade your plan to add more members.`,
    };
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
