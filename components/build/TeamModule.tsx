import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { OrganizationMember, Principal } from "@/lib/supabase/database.types";
import { ModuleHeader } from "./DraftWithEarn";
import { TeamControls, type TeamMemberView } from "./TeamControls";

export async function TeamModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();

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
      avatarUrl: p?.avatar_url ?? null,
      role: m.role,
    };
  });

  const self = byId.get(ctx.userId);
  const ownProfile = {
    full_name: self?.full_name ?? null,
    title: self?.title ?? null,
    avatar_url: self?.avatar_url ?? null,
  };

  return (
    <div>
      <ModuleHeader
        title="Team"
        blurb="Who runs the firm — members, roles, and bios."
        module="team"
      />

      {members.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No team members found.
        </p>
      ) : (
        <TeamControls
          members={memberViews}
          currentUserId={ctx.userId}
          currentRole={ctx.role}
          ownProfile={ownProfile}
        />
      )}

      <p className="mt-4 text-xs text-fg-muted">
        Only existing FundExecs users can be added. Ask Earn to draft team bios with the button above.
      </p>
    </div>
  );
}
