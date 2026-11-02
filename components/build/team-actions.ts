"use server";

import { revalidatePath } from "next/cache";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { planSeatLimit, seatLimitReached } from "@/lib/billing";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { savePendingInvite, sendMemberAddedEmail } from "@/lib/team-invites.server";
import {
  createTeamTask,
  normalizeTeamTaskPriority,
  recordOperatorFeedback,
} from "@/lib/team-tasks";
import { normalizeBio, normalizeEmail } from "@/lib/member-profile";
import { MEMBER_AVATAR_BUCKET, avatarObjectPath } from "@/lib/avatar";
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
//
// `avatar_url` is deliberately NOT writable here. A photo is an uploaded file
// we host, set through uploadAvatar/removeAvatar (components/shared/
// avatar-actions) -- accepting a caller-supplied string on this path is exactly
// how the column ended up holding three incompatible kinds of value.
export async function updateMyProfile(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const supabase = await createServerClient();
  await supabase
    .from("principals")
    .update({
      full_name: String(formData.get("full_name") ?? "").trim() || null,
      title: String(formData.get("title") ?? "").trim() || null,
      bio: normalizeBio(formData.get("bio")),
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
): Promise<{ error?: string; notice?: string }> {
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
  return addMemberByEmail(ctx as AdminCtx, email, role);
}

// 4b. Remind someone they were added. Admin/owner only. Works on an existing
// member (memberId) or an invite still waiting for a sign-in (inviteId), and
// only ever mails an address already on this organization's team. Best-effort
// rate limit per address so a double click or a script cannot spam anyone.
export async function resendInvite(
  formData: FormData,
): Promise<{ error?: string; notice?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "No active organization." };
  if (!isAdmin(ctx.role)) return { error: "Only admins and owners can send reminders." };

  const memberId = String(formData.get("memberId") ?? "").trim();
  const inviteId = String(formData.get("inviteId") ?? "").trim();
  if (!memberId && !inviteId) return { error: "Choose who to remind." };

  const svc = createServiceClient();
  let email: string;
  let role: MemberRole;
  let pending = false;

  if (inviteId) {
    const { data: invite } = await svc
      .from("organization_invites")
      .select("id, email, role, accepted_at")
      .eq("id", inviteId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (!invite || invite.accepted_at) return { error: "That invite is no longer pending." };
    email = invite.email;
    role = invite.role;
    pending = true;
  } else {
    const { data: member } = await svc
      .from("organization_members")
      .select("principal_id, role")
      .eq("id", memberId)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (!member) return { error: "That member isn't on this team." };
    if (member.principal_id === ctx.userId) return { error: "You don't need to remind yourself." };
    const { data: principal } = await svc
      .from("principals")
      .select("email")
      .eq("id", member.principal_id)
      .maybeSingle();
    if (!principal?.email) return { error: "That member has no email address on file." };
    email = principal.email.trim().toLowerCase();
    role = member.role;
  }

  const limited = checkRateLimit({
    key: `team-invite-resend:${ctx.orgId}:${email}`,
    limit: 1,
    windowMs: 5 * 60_000,
  });
  if (!limited.ok) {
    return { error: `A reminder was just sent to ${email}. Try again in a few minutes.` };
  }

  // A reminder on a waiting invite also gives it a fresh 30 days.
  if (pending) {
    await svc
      .from("organization_invites")
      .update({ expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() })
      .eq("id", inviteId);
  }

  const mail = await sendMemberAddedEmail(svc, {
    orgId: ctx.orgId,
    email,
    role,
    inviterId: ctx.userId,
    pending,
    reminder: true,
  });
  revalidatePath(TEAM);
  return mail.sent
    ? { notice: `Reminder sent to ${email}.` }
    : {
        error:
          "The reminder couldn't be sent. Connect a mailbox in Settings → Integrations, or let them know directly.",
      };
}

type AdminCtx = NonNullable<Awaited<ReturnType<typeof getSessionContext>>> & {
  orgId: string;
};

// Shared by inviteMember and giveProfileAccess. Callers MUST have passed the
// admin guard first. When the new member's email matches a no-login team
// profile, that profile is merged into them and removed (see mergeProfile).
async function addMemberByEmail(
  ctx: AdminCtx,
  email: string,
  role: MemberRole,
): Promise<{ error?: string; notice?: string }> {
  // Cross-org principal lookup needs the service client (RLS would hide
  // principals outside the caller's org). Only reached after the admin guard.
  const svc = createServiceClient();
  const { data: principal } = await svc
    .from("principals")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  // Avoid the unique-constraint round-trip when we can, and handle the race.
  if (principal) {
    const { data: existing } = await svc
      .from("organization_members")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("principal_id", principal.id)
      .maybeSingle();
    if (existing) {
      return { error: "That person is already a member of this organization." };
    }
  }

  // Seat limit: an org can only add members up to its plan's seat allotment.
  // Read the plan and current member count with the service client so the
  // check is reliable regardless of the caller's row-level visibility.
  // No-login team profiles are deliberately not counted: they are not logins.
  const { data: wallet } = await svc
    .from("wallets")
    .select("plan")
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  const { count: memberCount } = await svc
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.orgId);
  // Invites still waiting for a sign-in hold a seat too, or an org could stack
  // pending invites past its allotment and claim them all later.
  const { count: pendingCount } = await svc
    .from("organization_invites")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.orgId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString());
  // Platform admins are not bound by the seat allotment.
  if (
    !isPlatformAdmin(ctx) &&
    seatLimitReached(wallet?.plan, (memberCount ?? 0) + (pendingCount ?? 0))
  ) {
    const limit = planSeatLimit(wallet?.plan);
    return {
      error: `Your plan includes ${limit} seat${limit === 1 ? "" : "s"}. Upgrade your plan to add more members.`,
    };
  }

  // No account yet: hold the invite, email them, and attach them when they sign
  // in with this address (lib/team-invites.server.claimPendingInvites).
  if (!principal) {
    const saved = await savePendingInvite(svc, {
      orgId: ctx.orgId,
      email,
      role,
      invitedBy: ctx.userId,
      byPlatformAdmin: isPlatformAdmin(ctx),
    });
    if (saved.error) return { error: saved.error };
    const mail = await sendMemberAddedEmail(svc, {
      orgId: ctx.orgId,
      email,
      role,
      inviterId: ctx.userId,
      pending: true,
    });
    revalidatePath(TEAM);
    return {
      notice: mail.sent
        ? `Invite emailed to ${email}. They join automatically when they sign in.`
        : `Invite saved for ${email}, but the email could not be sent (connect a mailbox in Settings → Integrations). They join automatically when they sign in.`,
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

  await mergeProfile(svc, ctx.orgId, principal.id, email);

  const mail = await sendMemberAddedEmail(svc, {
    orgId: ctx.orgId,
    email,
    role,
    inviterId: ctx.userId,
    pending: false,
  });

  revalidatePath(TEAM);
  return {
    notice: mail.sent
      ? `Added, and ${email} was emailed.`
      : "Added. The email could not be sent (connect a mailbox in Settings → Integrations), so let them know directly.",
  };
}

// Fold a no-login profile into the account that now owns its email: fill the
// member's blank name/title/bio/photo from the profile (never overwrite what
// they wrote themselves), then drop the profile so the person is listed once.
// Best-effort -- the membership is already created, so a failure here leaves a
// harmless duplicate the admin can delete, and is logged rather than surfaced.
async function mergeProfile(
  svc: ReturnType<typeof createServiceClient>,
  orgId: string,
  principalId: string,
  email: string,
): Promise<void> {
  try {
    const { data: profile } = await svc
      .from("team_profiles")
      .select("*")
      .eq("organization_id", orgId)
      .eq("email", email)
      .maybeSingle();
    if (!profile) return;

    const { data: p } = await svc
      .from("principals")
      .select("full_name, title, bio, avatar_url")
      .eq("id", principalId)
      .maybeSingle();

    const patch: Record<string, string> = {};
    if (!p?.full_name && profile.full_name) patch.full_name = profile.full_name;
    if (!p?.title && profile.title) patch.title = profile.title;
    if (!p?.bio && profile.bio) patch.bio = profile.bio;

    if (!p?.avatar_url && profile.avatar_url) {
      const from = avatarObjectPath(orgId, profile.id, true);
      const to = avatarObjectPath(orgId, principalId);
      const { error: copyErr } = await svc.storage
        .from(MEMBER_AVATAR_BUCKET)
        .copy(from, to);
      if (!copyErr) {
        const { data: pub } = svc.storage.from(MEMBER_AVATAR_BUCKET).getPublicUrl(to);
        if (pub?.publicUrl) patch.avatar_url = pub.publicUrl;
      }
    }
    if (Object.keys(patch).length > 0) {
      await svc
        .from("principals")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", principalId);
    }

    await svc.from("team_profiles").delete().eq("id", profile.id);
    await svc.storage
      .from(MEMBER_AVATAR_BUCKET)
      .remove([avatarObjectPath(orgId, profile.id, true)]);
  } catch (err) {
    console.error("[mergeProfile]", err);
  }
}

// --- Team profiles: people on the team who have no login ------------------
// Owners and admins only. These rows are display data for the Team page and the
// data room; they are not members, grant no access, and use no seat.

function readProfileFields(
  formData: FormData,
): { error: string } | { fields: { full_name: string; title: string | null; email: string | null; bio: string | null } } {
  const full_name = String(formData.get("full_name") ?? "").trim().slice(0, 200);
  if (!full_name) return { error: "Enter a name." };
  const rawEmail = String(formData.get("email") ?? "").trim();
  const email = normalizeEmail(rawEmail);
  if (rawEmail && !email) return { error: "That email address doesn't look right." };
  return {
    fields: {
      full_name,
      title: String(formData.get("title") ?? "").trim().slice(0, 200) || null,
      email,
      bio: normalizeBio(formData.get("bio")),
    },
  };
}

export async function addTeamProfile(
  formData: FormData,
): Promise<{ error?: string; id?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "No active organization." };
  if (!isAdmin(ctx.role)) return { error: "Only admins and owners can add team profiles." };

  const parsed = readProfileFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createServerClient();

  // An email that already belongs to a real member would show them twice.
  if (parsed.fields.email) {
    const svc = createServiceClient();
    const { data: principal } = await svc
      .from("principals")
      .select("id")
      .eq("email", parsed.fields.email)
      .maybeSingle();
    if (principal) {
      const { data: member } = await svc
        .from("organization_members")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .eq("principal_id", principal.id)
        .maybeSingle();
      if (member) return { error: "That person is already a member of this team." };
    }
  }

  const { data, error } = await supabase
    .from("team_profiles")
    .insert({ organization_id: ctx.orgId, created_by: ctx.userId, ...parsed.fields })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "A team profile with that email already exists." };
    console.error("[addTeamProfile]", error.message);
    return { error: "Could not add that team member. Please try again." };
  }

  revalidatePath(TEAM);
  return { id: data?.id };
}

export async function updateTeamProfile(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "No active organization." };
  if (!isAdmin(ctx.role)) return { error: "Only admins and owners can edit team profiles." };

  const id = String(formData.get("profileId") ?? "").trim();
  if (!id) return { error: "Missing team profile." };
  const parsed = readProfileFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("team_profiles")
    .update({ ...parsed.fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("id");
  if (error) {
    if (error.code === "23505") return { error: "A team profile with that email already exists." };
    console.error("[updateTeamProfile]", error.message);
    return { error: "Could not save that profile. Please try again." };
  }
  if (!data?.length) return { error: "That team profile was not found." };

  revalidatePath(TEAM);
  return {};
}

export async function deleteTeamProfile(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  if (!isAdmin(ctx.role)) return;

  const id = String(formData.get("profileId") ?? "").trim();
  if (!id) return;

  const supabase = await createServerClient();
  await supabase
    .from("team_profiles")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.orgId);
  // Best-effort: the row is gone, so a failed delete only leaves storage litter.
  await supabase.storage
    .from(MEMBER_AVATAR_BUCKET)
    .remove([avatarObjectPath(ctx.orgId, id, true)]);

  revalidatePath(TEAM);
}

// Turn a no-login profile into a real member: look up the account by the
// profile's email and add it (seat-checked), merging the profile into it.
export async function giveProfileAccess(formData: FormData): Promise<{ error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { error: "No active organization." };
  if (!isAdmin(ctx.role)) return { error: "Only admins and owners can grant access." };

  const id = String(formData.get("profileId") ?? "").trim();
  const role = parseRole(formData.get("role")) ?? "member";
  const supabase = await createServerClient();
  const { data: profile } = await supabase
    .from("team_profiles")
    .select("email")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!profile) return { error: "That team profile was not found." };
  if (!profile.email) return { error: "Add an email to this profile first." };
  return addMemberByEmail(ctx as AdminCtx, profile.email.toLowerCase(), role);
}
