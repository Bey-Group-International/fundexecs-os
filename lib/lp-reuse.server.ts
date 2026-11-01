// lib/lp-reuse.server.ts
// Carries a returning LP's earlier ID verification onto their new onboarding, so
// they don't repeat it. Rules are in lib/lp-reuse.ts.
//
// It runs on the service role, after the caller has been confirmed an admin of
// the organization, because the checks table only lets a signed-in user write
// rows stamped with their own id and this is the system's record, not theirs.
// Because the service role bypasses row-level security, every query names the
// organization.
//
// It is an optimization and never an obstacle: any failure is logged and the
// link is made anyway, with nothing carried over.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeLike, normalizeEmail, REUSABLE_CHECK_KINDS, reusableChecks, type PriorCheck, type PriorSession } from "@/lib/lp-reuse";

type Client = SupabaseClient<any, any, any>;

export interface CarriedSummary {
  kind: string;
  checkedAt: string;
  expiresAt: string;
}

const MAX_PRIOR_SESSIONS = 50;

export async function carryForwardChecks(
  client: Client,
  args: { orgId: string; sessionId: string; email: string; now?: number },
): Promise<CarriedSummary[]> {
  const now = args.now ?? Date.now();
  try {
    const email = normalizeEmail(args.email);
    if (!email) return [];

    // The pattern match narrows the search; the exact comparison below decides.
    const { data: found, error } = await client
      .from("lp_onboarding_sessions")
      .select("id, review_state, lp_email")
      .eq("organization_id", args.orgId)
      .neq("id", args.sessionId)
      .ilike("lp_email", escapeLike(email))
      .limit(MAX_PRIOR_SESSIONS);
    if (error) throw new Error(error.message);
    const sessions = ((found ?? []) as Array<PriorSession & { lp_email: string }>).filter((s) => normalizeEmail(s.lp_email) === email);
    if (sessions.length === 0) return [];

    const ids = sessions.map((s) => s.id);
    const { data: priorChecks, error: checksError } = await client
      .from("onboarding_checks")
      .select("session_id, kind, status, method, vendor_ref, summary, checked_at, expires_at")
      .eq("organization_id", args.orgId)
      .in("session_id", ids)
      .in("kind", REUSABLE_CHECK_KINDS)
      .eq("status", "clear");
    if (checksError) throw new Error(checksError.message);

    const carry = reusableChecks(sessions, (priorChecks ?? []) as PriorCheck[], now);
    if (carry.length === 0) return [];

    // Never put a second check of a kind on the new onboarding.
    const { data: present } = await client
      .from("onboarding_checks")
      .select("kind")
      .eq("organization_id", args.orgId)
      .eq("session_id", args.sessionId);
    const have = new Set(((present ?? []) as Array<{ kind: string }>).map((r) => r.kind));
    const rows = carry.filter((c) => !have.has(c.kind));
    if (rows.length === 0) return [];

    const { error: insertError } = await client.from("onboarding_checks").insert(
      rows.map((c) => ({
        organization_id: args.orgId,
        session_id: args.sessionId,
        kind: c.kind,
        status: c.status,
        method: c.method,
        vendor_ref: c.vendor_ref,
        summary: c.summary,
        checked_at: c.checked_at,
        expires_at: c.expires_at,
        recorded_by: null,
      })),
    );
    if (insertError) throw new Error(insertError.message);
    return rows.map((c) => ({ kind: c.kind, checkedAt: c.checked_at, expiresAt: c.expires_at }));
  } catch (err) {
    console.error("[lp-reuse] could not carry earlier clearances forward", err);
    return [];
  }
}
