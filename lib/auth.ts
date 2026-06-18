// Server-side session/context helpers. The "active organization" is, for now,
// the principal's first membership (multi-org switching comes later). Returns
// enough context for the authed layout to gate routes and for API handlers to
// scope writes.
import { createServerClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/lib/supabase/database.types";

export interface SessionContext {
  userId: string;
  email: string;
  orgId: string | null;
  role: MemberRole | null;
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("principal_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? "",
    orgId: membership?.organization_id ?? null,
    role: (membership?.role as MemberRole) ?? null,
  };
}

/**
 * Resolve context for API handlers. Throws a typed reason when the request is
 * not workable so callers can map it to an HTTP status.
 */
export async function requireOrgContext(): Promise<
  | { ok: true; ctx: SessionContext & { orgId: string } }
  | { ok: false; status: 401 | 403; error: string }
> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, status: 401, error: "Not authenticated" };
  if (!ctx.orgId)
    return { ok: false, status: 403, error: "No active organization" };
  return { ok: true, ctx: { ...ctx, orgId: ctx.orgId } };
}
