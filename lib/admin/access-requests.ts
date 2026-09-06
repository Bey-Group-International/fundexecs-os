// Platform-admin side of the invite-only queue: list what's waiting and record
// an approve/decline made in the console. Every read goes through the
// service-role client (the queue table has RLS with no policies), so this module
// must only ever be reached after requirePlatformAdmin() has passed — the gate
// lives in the /admin layout and in app/admin/actions.ts, never here.
//
// The decision itself lives in lib/access-requests.ts, shared with the emailed
// Approve / Decline links, so both doors record the same thing the same way.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import {
  applyAccessDecision,
  normalizeEmail,
  type AccessDecisionRoute,
  type AccessRequestRow,
  type AccessRequestStatus,
  type DecisionResult,
} from "@/lib/access-requests";

/**
 * Every request, undecided first, newest first within each group. Returns an
 * empty list rather than throwing when the service env is absent — the admin
 * page already renders a "service role not configured" banner in that case.
 */
export async function listAccessRequests(): Promise<AccessRequestRow[]> {
  if (!hasSupabaseServiceEnv()) return [];

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("access_requests")
    .select(
      "id, email, full_name, firm, role, note, status, created_at, reviewed_at, decided_via",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error || !data) {
    if (error) console.error("[access-requests] list failed:", error);
    return [];
  }

  // One extra round trip tells us who already has an auth account, which is what
  // separates "approved and signed in" from "approved and never showed up".
  const emails = data.map((r) => r.email);
  const withAccount = new Set<string>();
  if (emails.length) {
    const { data: principals } = await supabase
      .from("principals")
      .select("email")
      .in("email", emails);
    for (const p of principals ?? []) withAccount.add(normalizeEmail(p.email));
  }

  const rows: AccessRequestRow[] = data.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    firm: r.firm,
    role: r.role,
    note: r.note,
    status: r.status as AccessRequestStatus,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    decidedVia: (r.decided_via as AccessDecisionRoute | null) ?? null,
    hasAccount: withAccount.has(normalizeEmail(r.email)),
  }));

  const rank = (s: AccessRequestStatus) => (s === "pending" ? 0 : 1);
  return rows.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Record a console decision, attributed to the admin who made it. */
export async function decideAccessRequest(args: {
  id: string;
  decision: Extract<AccessRequestStatus, "approved" | "declined">;
  reviewerId: string;
}): Promise<DecisionResult> {
  return applyAccessDecision({
    id: args.id,
    decision: args.decision,
    reviewerId: args.reviewerId,
    via: "admin",
  });
}
