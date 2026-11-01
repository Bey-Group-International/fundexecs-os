// lib/lp-reuse.server.ts
// A returning LP's earlier ID verification: FOUND when their link is made, and
// reused only once a fund manager confirms it is the same person. Rules are in
// lib/lp-reuse.ts.
//
// It runs on the service role, after the caller has been confirmed an admin of
// the organization, because the checks table only lets a signed-in user write
// rows stamped with their own id and this is the system's record, not theirs.
// Because the service role bypasses row-level security, every query names the
// organization.
//
// Proposing is an optimization and never an obstacle: any failure is logged and
// the link is made anyway, with nothing proposed.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canConfirmCarryover,
  escapeLike,
  namesMatch,
  normalizeEmail,
  REUSABLE_CHECK_KINDS,
  reusableChecks,
  type PriorCheck,
  type PriorSession,
} from "@/lib/lp-reuse";

type Client = SupabaseClient<any, any, any>;

export interface CarriedSummary {
  kind: string;
  checkedAt: string;
  expiresAt: string;
  namesMatch: boolean;
}

/** Records, for a fund manager to confirm, the earlier ID check that could be reused. Nothing is trusted yet. */
export async function proposeCarryover(
  client: Client,
  args: { orgId: string; sessionId: string; email: string; lpName?: string; now?: number },
): Promise<CarriedSummary[]> {
  const now = args.now ?? Date.now();
  try {
    const email = normalizeEmail(args.email);
    if (!email) return [];

    // The pattern match narrows the search; the exact comparison below decides.
    const { data: found, error } = await client
      .from("lp_onboarding_sessions")
      .select("id, review_state, lp_email, lp_name")
      .eq("organization_id", args.orgId)
      .neq("id", args.sessionId)
      .ilike("lp_email", escapeLike(email));
    // No row limit: this is one address in one organization, and a cap could cut
    // off an older rejection, which must always be seen.
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

    // The new onboarding already has an ID check (or an open proposal): leave it alone.
    const { data: present } = await client
      .from("onboarding_checks")
      .select("kind")
      .eq("organization_id", args.orgId)
      .eq("session_id", args.sessionId);
    const have = new Set(((present ?? []) as Array<{ kind: string }>).map((r) => r.kind));
    const rows = carry.filter((c) => !have.has(c.kind));
    if (rows.length === 0) return [];

    const out: CarriedSummary[] = [];
    for (const c of rows) {
      const match = namesMatch(args.lpName, c.fromName);
      const { error: insertError } = await client.from("lp_identity_carryover").insert({
        session_id: args.sessionId,
        organization_id: args.orgId,
        from_session_id: c.fromSessionId,
        prior_name: c.fromName,
        names_match: match,
        kind: c.kind,
        method: c.method,
        vendor_ref: c.vendor_ref,
        summary: c.summary,
        checked_at: c.checked_at,
        expires_at: c.expires_at,
        status: "proposed",
      });
      if (insertError) throw new Error(insertError.message);
      out.push({ kind: c.kind, checkedAt: c.checked_at, expiresAt: c.expires_at, namesMatch: match });
    }
    return out;
  } catch (err) {
    console.error("[lp-reuse] could not look for an earlier clearance", err);
    return [];
  }
}

export type DecideOutcome = "confirmed" | "declined" | "not_found" | "expired" | "already_has_check" | "error";

/**
 * A fund manager's answer. Confirming writes the earlier clearance onto this
 * onboarding as a clear check, dated as it was; declining leaves the LP to verify
 * for themselves. The proposal is claimed first, in one conditional update, so a
 * double click or two admins cannot both act on it.
 */
export async function decideCarryover(
  client: Client,
  args: { orgId: string; sessionId: string; decision: "confirm" | "decline"; actorId: string; now?: number },
): Promise<DecideOutcome> {
  const now = args.now ?? Date.now();
  try {
    const { data: proposal } = await client
      .from("lp_identity_carryover")
      .select("method, vendor_ref, summary, checked_at, expires_at, status, kind")
      .eq("organization_id", args.orgId)
      .eq("session_id", args.sessionId)
      .maybeSingle();
    const p = proposal as {
      method: string;
      vendor_ref: string | null;
      summary: string | null;
      checked_at: string;
      expires_at: string;
      status: string;
      kind: string;
    } | null;
    if (!p || p.status !== "proposed") return "not_found";

    const target = args.decision === "confirm" ? "confirmed" : "declined";
    if (args.decision === "confirm" && !canConfirmCarryover(p, now)) return "expired";

    // Claim: only a still-open proposal matches.
    const { data: claimed, error: claimError } = await client
      .from("lp_identity_carryover")
      .update({ status: target, decided_by: args.actorId, decided_at: new Date(now).toISOString() })
      .eq("organization_id", args.orgId)
      .eq("session_id", args.sessionId)
      .eq("status", "proposed")
      .select("session_id");
    if (claimError || !claimed || claimed.length === 0) return "not_found";
    if (args.decision === "decline") return "declined";

    const { data: present } = await client
      .from("onboarding_checks")
      .select("kind")
      .eq("organization_id", args.orgId)
      .eq("session_id", args.sessionId)
      .eq("kind", p.kind);
    if (((present ?? []) as unknown[]).length > 0) return "already_has_check";

    const { error: insertError } = await client.from("onboarding_checks").insert({
      organization_id: args.orgId,
      session_id: args.sessionId,
      kind: p.kind,
      status: "clear",
      method: p.method,
      vendor_ref: p.vendor_ref,
      summary: p.summary,
      checked_at: p.checked_at,
      expires_at: p.expires_at,
      recorded_by: args.actorId,
    });
    if (insertError) {
      // Put the proposal back so the manager can try again.
      await client
        .from("lp_identity_carryover")
        .update({ status: "proposed", decided_by: null, decided_at: null })
        .eq("organization_id", args.orgId)
        .eq("session_id", args.sessionId);
      throw new Error(insertError.message);
    }
    return "confirmed";
  } catch (err) {
    console.error("[lp-reuse] could not record the decision", err);
    return "error";
  }
}
