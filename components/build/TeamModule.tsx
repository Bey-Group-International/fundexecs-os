import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { OrganizationMember, Principal } from "@/lib/supabase/database.types";
import { ModuleHeader } from "./DraftWithEarn";

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
        <div className="flex flex-col gap-2">
          {members.map((m) => {
            const p = byId.get(m.principal_id);
            const name = p?.full_name || p?.email || "Member";
            const initial = name.charAt(0).toUpperCase();
            return (
              <div key={m.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 p-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-sm font-medium text-fg-primary">
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg-primary">{name}</p>
                  {p?.title ? <p className="truncate text-xs text-fg-muted">{p.title}</p> : null}
                </div>
                <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {m.role}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-fg-muted">
        Invites are managed in onboarding for now. Ask Earn to draft team bios with the button above.
      </p>
    </div>
  );
}
