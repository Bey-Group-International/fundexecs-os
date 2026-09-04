// lib/meetings/directory.server.ts
// Loading the organization's own member directory, so an attendee entered by
// name can be emailed. See directory.ts for the matching itself.
import type { createServerClient } from "@/lib/supabase/server";
import type { OrganizationMember, Principal } from "@/lib/supabase/database.types";
import type { DirectoryMember } from "@/lib/meetings/directory";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * A member can read every principal in their own organization (the
 * principals_select RLS policy), so this runs on the caller's client — no
 * service role, and a deployment without one still resolves teammates.
 *
 * Never throws. Failing to load the directory means an attendee typed by name
 * goes unmatched and is reported unreachable, which is exactly what happened
 * before this existed — it must not cost the host their meeting.
 */
export async function loadOrgDirectory(
  supabase: ServerClient,
  orgId: string,
  limit = 500,
): Promise<DirectoryMember[]> {
  try {
    const { data: members, error } = await supabase
      .from("organization_members")
      .select("principal_id")
      .eq("organization_id", orgId)
      .limit(limit);
    if (error) return [];

    const ids = [...new Set(((members ?? []) as Pick<OrganizationMember, "principal_id">[]).map((m) => m.principal_id))];
    if (ids.length === 0) return [];

    const { data: principals, error: principalError } = await supabase
      .from("principals")
      .select("full_name, email")
      .in("id", ids);
    if (principalError) return [];

    return ((principals ?? []) as Pick<Principal, "full_name" | "email">[])
      .filter((p) => !!p.email?.trim())
      .map((p) => ({ name: p.full_name, email: p.email }));
  } catch {
    return [];
  }
}
