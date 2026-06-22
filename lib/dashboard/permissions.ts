import type { SessionContext } from "@/lib/auth";

export function canManageDashboard(ctx: SessionContext | null): ctx is SessionContext & { orgId: string } {
  return Boolean(ctx?.orgId && ctx.role && ctx.role !== "viewer");
}

export function dashboardPermissionError(ctx: SessionContext | null): string {
  if (!ctx) return "Not authenticated";
  if (!ctx.orgId) return "No active organization";
  return "Your role can view this workspace but cannot make changes.";
}
