import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient, createServiceClient } from "@/lib/supabase/server";
import { getWallet } from "@/lib/wallet";
import { planSeatLimit } from "@/lib/billing";
import { ADMIN_PLAN_NAME, isPlatformAdmin } from "@/lib/platform-admin";
import { avatarUrlWithVersion } from "@/lib/avatar";
import type { OrganizationMember, Principal, TeamProfile } from "@/lib/supabase/database.types";
import { ModuleHeader } from "./DraftWithEarn";
import {
  TeamControls,
  type PendingInviteView,
  type TeamMemberView,
  type TeamProfileView,
} from "./TeamControls";

export async function TeamModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = await createServerClient();

  const { data: memberData } = await supabase
    .from("organization_members")
    .select("*")
    .eq("organization_id", ctx.orgId);
  const members = (memberData ?? []) as OrganizationMember[];

  const { data: principalData } = await supabase
    .from("principals")
    .select("*")
    .in("id", members.map((m) => m.principal_id).length ? members.map((m) => m.principal_id) : ["00000000-0000-0000-0000-000000000000"]);
  const principals = (principalData ?? []) as Principal[];
  const byId = new Map(principals.map((p) => [p.id, p]));

  const memberViews: TeamMemberView[] = members.map((m) => {
    const p = byId.get(m.principal_id);
    return {
      memberId: m.id,
      principalId: m.principal_id,
      name: p?.full_name || p?.email || "Member",
      email: p?.email || "",
      title: p?.title ?? null,
      bio: p?.bio ?? null,
      avatarUrl: p?.avatar_url ? avatarUrlWithVersion(p.avatar_url, p.updated_at) : null,
      role: m.role,
    };
  });

  const { data: profileData } = await supabase
    .from("team_profiles")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: true });
  const profileViews: TeamProfileView[] = ((profileData ?? []) as TeamProfile[]).map((t) => ({
    profileId: t.id,
    name: t.full_name,
    email: t.email ?? "",
    title: t.title,
    bio: t.bio,
    avatarUrl: t.avatar_url ? avatarUrlWithVersion(t.avatar_url, t.updated_at) : null,
  }));

  // Pending invites are admin-only (RLS), so read them with the service role
  // after checking the role here.
  const viewerIsAdmin = ctx.role === "owner" || ctx.role === "admin";
  let pendingInvites: PendingInviteView[] = [];
  if (viewerIsAdmin) {
    const { data: inviteData } = await createServiceClient()
      .from("organization_invites")
      .select("id, email, role, created_at, expires_at")
      .eq("organization_id", ctx.orgId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true });
    pendingInvites = (inviteData ?? []).map((i) => ({
      inviteId: i.id,
      email: i.email,
      role: i.role,
      sentAt: i.created_at,
    }));
  }

  const self = byId.get(ctx.userId);
  const ownProfile = {
    full_name: self?.full_name ?? null,
    title: self?.title ?? null,
    bio: self?.bio ?? null,
    avatar_url: self?.avatar_url
      ? avatarUrlWithVersion(self.avatar_url, self.updated_at)
      : null,
  };

  const wallet = await getWallet(ctx.orgId);
  // Platform admins are not bound by the seat allotment (see team-actions).
  const admin = isPlatformAdmin(ctx);
  const seats = {
    used: members.length,
    limit: admin ? null : planSeatLimit(wallet?.plan),
    adminPlanName: admin ? ADMIN_PLAN_NAME : undefined,
  };

  return (
    <div>
      <ModuleHeader
        title="Team"
        blurb="Who runs the firm — members, roles, and bios."
        module="team"
      />

      {members.length === 0 && profileViews.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No team members found.
        </p>
      ) : (
        <TeamControls
          members={memberViews}
          profiles={profileViews}
          pendingInvites={pendingInvites}
          currentUserId={ctx.userId}
          currentRole={ctx.role}
          ownProfile={ownProfile}
          seats={seats}
        />
      )}

      <p className="mt-4 text-xs text-fg-muted">
        Members can sign in. Team profiles are people who appear on the firm page and in the data room but have no login and use no seat. Ask Earn to draft team bios with the button above.
      </p>
    </div>
  );
}
