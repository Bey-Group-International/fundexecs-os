// lib/meetings/directory.server.ts
// Loading the organization's own member directory, so an attendee entered by
// name can be emailed. See directory.ts for the matching itself.
import type { createServerClient } from "@/lib/supabase/server";
import type { OrganizationMember, Principal } from "@/lib/supabase/database.types";
import type { DirectoryMember } from "@/lib/meetings/directory";

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Rows per read. Both tables are paged so neither silently truncates. */
const PAGE_SIZE = 500;

/**
 * How many members this will load before giving up.
 *
 * A ceiling has to exist — this runs inside a save — but hitting it does NOT
 * mean "match against what we have". See below.
 */
const MAX_MEMBERS = 5000;

/**
 * The organization's members, or an empty directory when it cannot be loaded
 * in full.
 *
 * A member can read every principal in their own organization (the
 * principals_select RLS policy), so this runs on the caller's client — no
 * service role, and a deployment without one still resolves teammates.
 *
 * **Fails closed, and that is the whole point.** resolveAttendeeDirectory
 * promises unique-or-nothing: a name two members answer to resolves to neither.
 * That promise is only worth anything if the directory is complete — against a
 * partial one, a name that is ambiguous in the organization can look unique in
 * the half that loaded, and the invitation goes to the wrong colleague. So a
 * short read returns nothing rather than something: the attendees are reported
 * unreachable, the host is told, and nobody is emailed by mistake.
 *
 * Never throws.
 */
export async function loadOrgDirectory(
  supabase: ServerClient,
  orgId: string,
  maxMembers = MAX_MEMBERS,
): Promise<DirectoryMember[]> {
  try {
    const ids = new Set<string>();
    for (let page = 0; page * PAGE_SIZE <= maxMembers; page += 1) {
      const { data, error } = await supabase
        .from("organization_members")
        .select("principal_id")
        .eq("organization_id", orgId)
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) return [];

      const rows = (data ?? []) as Pick<OrganizationMember, "principal_id">[];
      for (const row of rows) ids.add(row.principal_id);
      // A short page is the last page.
      if (rows.length < PAGE_SIZE) break;
      // A directory this large has not been read in full, and a partial one is
      // worse than none — see above.
      if (ids.size > maxMembers) return [];
    }
    if (ids.size === 0) return [];

    // `in()` on thousands of ids is a URL nobody should build. Chunked, and a
    // failed chunk fails the whole directory rather than shrinking it.
    const out: DirectoryMember[] = [];
    const all = [...ids];
    for (let i = 0; i < all.length; i += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("principals")
        .select("full_name, email")
        .in("id", all.slice(i, i + PAGE_SIZE));
      if (error) return [];

      for (const p of (data ?? []) as Pick<Principal, "full_name" | "email">[]) {
        if (p.email?.trim()) out.push({ name: p.full_name, email: p.email });
      }
    }

    return out;
  } catch {
    return [];
  }
}
