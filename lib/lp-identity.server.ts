// lib/lp-identity.server.ts
// Brings an LP's Stripe Identity result into their onboarding check. There is no
// Stripe webhook for this, so it runs when the LP comes back to their link and
// when the fund manager presses refresh.
//
// It only ever touches a check that is still pending and was started through
// Stripe: a result the fund manager recorded or decided is never overwritten.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { stripeIdentityProvider } from "@/lib/providers/stripe-identity";
import { identityOutcome, type IdentityState } from "@/lib/lp-identity";

type Client = SupabaseClient<Database>;

export type IdentityCheckResult =
  | { ok: true; state: IdentityState; url: string | null }
  | { ok: false; error: string };

interface CheckRow {
  status: string;
  method: string;
  vendor_ref: string | null;
}

/** The identity check on file for a session, if any. */
export async function readIdentityCheck(supabase: Client, sessionId: string): Promise<CheckRow | null> {
  const { data } = await supabase
    .from("onboarding_checks")
    .select("status, method, vendor_ref")
    .eq("session_id", sessionId)
    .eq("kind", "identity")
    .maybeSingle();
  return (data as CheckRow | null) ?? null;
}

/** Asks Stripe where a started verification stands, and records it. */
export async function refreshIdentityCheck(supabase: Client, sessionId: string, orgId: string): Promise<IdentityCheckResult> {
  const row = await readIdentityCheck(supabase, sessionId);
  if (!row || row.method !== "stripe_identity" || !row.vendor_ref) {
    return { ok: true, state: row?.status === "clear" ? "verified" : "none", url: null };
  }
  if (row.status === "clear") return { ok: true, state: "verified", url: null };
  if (row.status !== "pending") return { ok: true, state: row.status === "failed" ? "canceled" : "none", url: null };

  const res = await stripeIdentityProvider.getStatus(row.vendor_ref, orgId);
  if (!res.ok || !res.data) return { ok: false, error: "We couldn't reach the verification service. Try again in a moment." };

  const outcome = identityOutcome(res.data);
  const { error } = await supabase
    .from("onboarding_checks")
    .update(outcome.check as never)
    .eq("session_id", sessionId)
    .eq("kind", "identity")
    .eq("method", "stripe_identity")
    .eq("status", "pending");
  if (error) {
    console.error("refreshIdentityCheck failed", { code: error.code, message: error.message });
    return { ok: false, error: "Couldn't save the result. Try again." };
  }
  return { ok: true, state: outcome.state, url: outcome.state === "needs_input" ? (res.reference ?? null) : null };
}
