// Platform-admin side of the invite-only queue: list what's waiting and record
// an approve/decline. Every read and write goes through the service-role client
// (the queue table has RLS with no policies), so this module must only ever be
// reached after requirePlatformAdmin() has passed — the gate lives in the
// /admin layout and in app/admin/actions.ts, never here.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import {
  accessApprovedEmail,
  normalizeEmail,
  type AccessRequestRow,
  type AccessRequestStatus,
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
    .select("id, email, full_name, firm, role, note, status, created_at, reviewed_at")
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
    hasAccount: withAccount.has(normalizeEmail(r.email)),
  }));

  const rank = (s: AccessRequestStatus) => (s === "pending" ? 0 : 1);
  return rows.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export type DecisionResult = { ok: true } | { ok: false; error: string };

/**
 * Approve or decline one request.
 *
 * Approving does two things: it marks the queue row, and — when the person
 * already has an auth account (they signed in once and were bounced) — it
 * stamps principals.access_approved_at so their next sign-in goes straight
 * through. A requester who has never signed in gets stamped by the auth gate
 * itself on first sign-in (enforceAccessGate's "grant" path).
 */
export async function decideAccessRequest(args: {
  id: string;
  decision: Extract<AccessRequestStatus, "approved" | "declined">;
  reviewerId: string;
}): Promise<DecisionResult> {
  if (!hasSupabaseServiceEnv()) {
    return { ok: false, error: "Supabase service-role env is not configured." };
  }

  const supabase = createServiceClient();
  const { data: updated, error } = await supabase
    .from("access_requests")
    .update({
      status: args.decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: args.reviewerId,
    })
    .eq("id", args.id)
    .select("email, full_name, status")
    .maybeSingle();

  if (error || !updated) {
    if (error) console.error("[access-requests] decide failed:", error);
    return { ok: false, error: "Could not record that decision. Try again." };
  }

  if (args.decision !== "approved") return { ok: true };

  // Exact match only — never ILIKE, whose `_` wildcard is a legal email
  // character and would widen an approval to accounts nobody approved. A
  // principal whose stored email differs in case simply isn't stamped here;
  // enforceAccessGate's "grant" path stamps them on their next sign-in instead.
  const email = normalizeEmail(updated.email);
  await supabase
    .from("principals")
    .update({ access_approved_at: new Date().toISOString() })
    .eq("email", email)
    .is("access_approved_at", null);

  // Best-effort invitation — a mail failure must not undo an approval that is
  // already recorded.
  try {
    const template = accessApprovedEmail({ fullName: updated.full_name, email });
    await sendEmail({
      to: { name: updated.full_name || email, email },
      subject: template.subject,
      htmlBody: template.html,
      fromName: "FundExecs OS",
    });
  } catch (err) {
    console.error("[access-requests] approval email failed:", err);
  }

  return { ok: true };
}
