// Office approval authority — the single source of truth for which org role
// may clear which approval tier.
//
// This is the TRUSTED authorization policy. It keys off the server-derived
// organization membership role (MemberRole), NOT the client-settable office
// role or any UI state. The same policy is enforced at the database layer by
// `office_role_can_approve()` / the office_approvals RLS in migration
// 20260705000000_office_approval_enforcement.sql — this module and that SQL
// MUST stay in lockstep. Pure (no I/O) so it can be unit-tested and reused on
// both the client (fast UX pre-check) and the server (authoritative check).

import type { MemberRole } from "@/lib/supabase/database.types";
import type { OfficeRole, RiskTier } from "@/components/virtual-office/program/officeProgram";

/** The non-internal tiers that require an approval gate. */
export type ApprovalTier = Exclude<RiskTier, "internal">;

/**
 * Whether an organization member's role authorizes clearing the given tier.
 *
 *   external_facing (Tier 2) → owner, admin, member
 *   capital_binding (Tier 3) → owner, admin only
 *   viewer                   → never
 *
 * Mirrors office_role_can_approve() in the DB.
 */
export function memberRoleCanApprove(role: MemberRole | null, tier: ApprovalTier): boolean {
  if (!role) return false;
  switch (tier) {
    case "external_facing":
      return role === "owner" || role === "admin" || role === "member";
    case "capital_binding":
      return role === "owner" || role === "admin";
    default:
      return false;
  }
}

/**
 * Map the trusted org membership role to the office's display role. The office
 * role is presentational only — authorization always flows from MemberRole via
 * `memberRoleCanApprove`.
 */
export function officeRoleFromMemberRole(role: MemberRole | null): OfficeRole {
  switch (role) {
    case "owner":  return "managing_partner";
    case "admin":  return "compliance";
    case "member": return "principal";
    case "viewer": return "observer";
    default:       return "observer";
  }
}
