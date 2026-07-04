import type { MemberRole } from "@/lib/supabase/database.types";

export const ORG_WRITE_ROLES: MemberRole[] = ["owner", "admin", "member"];
export const ORG_ADMIN_ROLES: MemberRole[] = ["owner", "admin"];

export function canWriteOrg(role: MemberRole | null | undefined): boolean {
  return role != null && ORG_WRITE_ROLES.includes(role);
}

export function canAdminOrg(role: MemberRole | null | undefined): boolean {
  return role != null && ORG_ADMIN_ROLES.includes(role);
}

export function requireOrgAdmin(role: MemberRole | null | undefined):
  | { ok: true }
  | { ok: false; status: 403; error: string } {
  if (canAdminOrg(role)) return { ok: true };
  return { ok: false, status: 403, error: "Owner or admin role required" };
}
