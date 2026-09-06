// Invite-only access control.
//
// FundExecs OS has no self-serve sign-up. A prospective operator submits an
// access request (app/request-access), a platform admin approves it — from the
// admin console or straight from the alert email — and only then does a sign-in
// complete. The pieces live here so every entry point applies the SAME rules and
// they can never drift apart:
//
//   submitAccessRequest    the public form writes the queue + alerts the team
//   enforceAccessGate      both auth paths check approval before a session stands
//   applyAccessDecision    the one place a decision is recorded, either door
//   *DecisionToken         the credential behind the email's Approve / Decline
//
// Server-only by construction: every read/write goes through the service-role
// client, which is never present in the browser bundle. The queue table also
// carries RLS with no policies, so a leaked anon key buys nothing.
import { createHash, randomBytes } from "crypto";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";
import { accessApprovedEmail, accessRequestEmail } from "@/lib/access-request-emails";
import { adminAlertRecipients, isPlatformAdminEmail } from "@/lib/platform-admin";
import { SITE_URL } from "@/lib/site";

export type AccessRequestStatus = "pending" | "approved" | "declined";
export type AccessDecisionRoute = "admin" | "email";

export interface AccessRequestInput {
  email: string;
  fullName?: string | null;
  firm?: string | null;
  role?: string | null;
  note?: string | null;
}

export interface AccessRequestRow {
  id: string;
  email: string;
  fullName: string | null;
  firm: string | null;
  role: string | null;
  note: string | null;
  status: AccessRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
  decidedVia: AccessDecisionRoute | null;
  /** True when an auth user already exists for this email. */
  hasAccount: boolean;
}

/** Longest value we persist per free-text field — a form post is untrusted. */
const MAX_SHORT = 200;
const MAX_NOTE = 2000;

/**
 * How long an emailed Approve / Decline link stays live. Long enough to survive
 * a holiday, short enough that an old forwarded thread is inert.
 */
export const DECISION_TOKEN_TTL_DAYS = 14;

/** Lower/trim an email so it matches the unique constraint on the queue. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Shape-check an email without pretending to validate deliverability: one `@`,
 * something either side, a dot in the domain, no whitespace.
 */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);
}

function clamp(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export type NormalizedAccessRequest = {
  email: string;
  full_name: string | null;
  firm: string | null;
  role: string | null;
  note: string | null;
};

/**
 * Validate + normalize a submitted request. Pure — no IO — so the rules are
 * unit-testable and identical wherever a request enters.
 */
export function normalizeAccessRequest(
  input: AccessRequestInput,
): { ok: true; value: NormalizedAccessRequest } | { ok: false; error: string } {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter your work email." };
  if (email.length > MAX_SHORT || !isPlausibleEmail(email)) {
    return { ok: false, error: "Enter a valid work email address." };
  }
  return {
    ok: true,
    value: {
      email,
      full_name: clamp(input.fullName, MAX_SHORT),
      firm: clamp(input.firm, MAX_SHORT),
      role: clamp(input.role, MAX_SHORT),
      note: clamp(input.note, MAX_NOTE),
    },
  };
}

// ---------------------------------------------------------------------------
// Decision tokens — the credential behind the email's Approve / Decline buttons
// ---------------------------------------------------------------------------

/**
 * A fresh decision token. Returns the raw value (goes in the emailed link, is
 * never persisted) alongside the hash and expiry that ARE persisted, so a leak
 * of the table yields no working links.
 */
export function mintDecisionToken(now: Date = new Date()): {
  token: string;
  hash: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashDecisionToken(token),
    expiresAt: new Date(
      now.getTime() + DECISION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

/** The stored form of a decision token. */
export function hashDecisionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The confirmation-page URL for one decision. The page is a landing pad, not the
 * action: nothing is granted until the reader confirms there, which is what
 * keeps a mail scanner's prefetch harmless.
 */
export function decisionUrl(token: string, decision: "approve" | "decline"): string {
  const url = new URL("/access-decision", SITE_URL);
  url.searchParams.set("token", token);
  url.searchParams.set("decision", decision);
  return url.toString();
}

/** The request a decision token points at, or null when the link is spent. */
export interface TokenLookup {
  id: string;
  email: string;
  fullName: string | null;
  firm: string | null;
  role: string | null;
  note: string | null;
  status: AccessRequestStatus;
  createdAt: string;
}

/**
 * Resolve a raw token to its request. Returns null for anything not currently
 * actionable — unknown, expired, or already spent — because the page must not
 * distinguish those cases to whoever is holding the link.
 */
export async function lookupDecisionToken(
  token: string,
  now: Date = new Date(),
): Promise<TokenLookup | null> {
  if (!token || !hasSupabaseServiceEnv()) return null;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("access_requests")
      .select(
        "id, email, full_name, firm, role, note, status, created_at, decision_token_expires_at",
      )
      .eq("decision_token_hash", hashDecisionToken(token))
      .maybeSingle();

    if (error || !data) return null;
    if (
      !data.decision_token_expires_at ||
      new Date(data.decision_token_expires_at).getTime() <= now.getTime()
    ) {
      return null;
    }

    return {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      firm: data.firm,
      role: data.role,
      note: data.note,
      status: data.status as AccessRequestStatus,
      createdAt: data.created_at,
    };
  } catch (err) {
    console.error("[access-request] lookupDecisionToken failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The sign-in gate
// ---------------------------------------------------------------------------

/**
 * What an authenticating principal is allowed to do.
 *
 *   allow    — already approved (or internal); let the session stand.
 *   grant    — an approved request exists but the principal isn't stamped yet;
 *              stamp access_approved_at, then let the session stand.
 *   pending  — request is in the queue, not decided. Sign them back out.
 *   declined — request was turned down. Sign them back out.
 *   none     — no request at all (e.g. a fresh Google sign-in). Sign them out
 *              and send them to the request form.
 */
export type AccessDecision = "allow" | "grant" | "pending" | "declined" | "none";

/**
 * Pure decision table for the sign-in gate. Platform admins are never gated —
 * the internal team must always be able to reach the console that approves
 * everyone else, even on a brand-new account.
 */
export function decideAccess(input: {
  approvedAt: string | null;
  requestStatus: AccessRequestStatus | null;
  isInternal: boolean;
}): AccessDecision {
  if (input.isInternal) return "allow";
  if (input.approvedAt) return "allow";
  if (input.requestStatus === "approved") return "grant";
  if (input.requestStatus === "pending") return "pending";
  if (input.requestStatus === "declined") return "declined";
  return "none";
}

/** Where a blocked sign-in is sent, with copy explaining what happens next. */
export function blockedRedirectPath(decision: AccessDecision, email: string): string {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (decision === "pending") params.set("status", "pending");
  else if (decision === "declined") params.set("status", "declined");
  else params.set("status", "required");
  return `/request-access?${params.toString()}`;
}

/**
 * Apply the invite-only gate to a just-authenticated user.
 *
 * Returns null when the session may stand, or the path to bounce them to.
 * Fails OPEN when the service-role env is absent (local/preview deployments
 * without it): a misconfigured environment must not lock out the whole app,
 * and without the service client we cannot read the queue at all.
 */
export async function enforceAccessGate(args: {
  userId: string;
  email: string | null | undefined;
}): Promise<string | null> {
  const email = normalizeEmail(args.email);
  if (isPlatformAdminEmail(email)) return null;
  if (!hasSupabaseServiceEnv()) return null;

  try {
    const supabase = createServiceClient();

    const { data: principal } = await supabase
      .from("principals")
      .select("access_approved_at")
      .eq("id", args.userId)
      .maybeSingle();

    let requestStatus: AccessRequestStatus | null = null;
    if (!principal?.access_approved_at && email) {
      const { data: request } = await supabase
        .from("access_requests")
        .select("status")
        .eq("email", email)
        .maybeSingle();
      requestStatus = (request?.status as AccessRequestStatus | undefined) ?? null;
    }

    const decision = decideAccess({
      approvedAt: principal?.access_approved_at ?? null,
      requestStatus,
      isInternal: false,
    });

    if (decision === "allow") return null;
    if (decision === "grant") {
      await supabase
        .from("principals")
        .update({ access_approved_at: new Date().toISOString() })
        .eq("id", args.userId);
      return null;
    }
    return blockedRedirectPath(decision, email);
  } catch (err) {
    // A gate that throws must not become a gate that locks everyone out.
    console.error("[access-gate] enforceAccessGate failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Submitting a request
// ---------------------------------------------------------------------------

export type SubmitResult = { ok: true } | { ok: false; error: string };

/**
 * Record a public access request and alert the internal team.
 *
 * Deliberately uniform in what it tells the caller: the same acknowledgement
 * whether the email is new, already queued, already approved, or already an
 * account, so the public form can't be used to enumerate who is on the
 * platform. A repeat submission refreshes the details without disturbing a
 * decision that has already been made (`status` is never written here).
 */
export async function submitAccessRequest(input: AccessRequestInput): Promise<SubmitResult> {
  const normalized = normalizeAccessRequest(input);
  if (!normalized.ok) return normalized;

  if (!hasSupabaseServiceEnv()) {
    return {
      ok: false,
      error:
        "Access requests are not configured for this environment. Email the team directly and we'll set you up.",
    };
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("access_requests")
    .upsert(normalized.value, { onConflict: "email" });

  if (error) {
    console.error("[access-request] upsert failed:", error);
    return { ok: false, error: "Could not submit your request. Please try again." };
  }

  await notifyAccessRequestOnce(normalized.value.email);
  return { ok: true };
}

/**
 * Email the internal team about a new access request, at most once per
 * requester. Same atomic-claim shape as the signup alert: the UPDATE only
 * matches a row whose alerted_at is still null, so repeat submissions and
 * concurrent calls send exactly one message. The claim also mints the decision
 * token in the same statement, so the token that reaches the inbox is the one
 * this row carries and a losing racer can never overwrite it.
 *
 * Best-effort throughout — an email hiccup must never fail the request the
 * operator just submitted.
 */
async function notifyAccessRequestOnce(email: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    const minted = mintDecisionToken();
    const { data: claimed, error } = await supabase
      .from("access_requests")
      .update({
        alerted_at: new Date().toISOString(),
        decision_token_hash: minted.hash,
        decision_token_expires_at: minted.expiresAt,
      })
      .eq("email", email)
      .is("alerted_at", null)
      .select("email, full_name, firm, role, note, created_at")
      .maybeSingle();

    if (error || !claimed) return;

    const recipients = adminAlertRecipients();
    if (recipients.length === 0) {
      console.warn(
        "[access-request] request recorded but no ADMIN_ALERT_EMAIL/ADMIN_EMAILS configured — skipping email.",
      );
      return;
    }

    const template = accessRequestEmail({
      email: claimed.email,
      fullName: claimed.full_name,
      firm: claimed.firm,
      role: claimed.role,
      note: claimed.note,
      createdAt: claimed.created_at,
      approveUrl: decisionUrl(minted.token, "approve"),
      declineUrl: decisionUrl(minted.token, "decline"),
    });

    // Fan out to each recipient independently so one bad address doesn't drop
    // the rest.
    await Promise.allSettled(
      recipients.map((to) =>
        sendEmail({
          to: { name: "FundExecs Admin", email: to },
          subject: template.subject,
          htmlBody: template.html,
          fromName: "FundExecs OS",
        }),
      ),
    );
  } catch (err) {
    console.error("[access-request] notifyAccessRequestOnce failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Recording a decision — the one path both doors go through
// ---------------------------------------------------------------------------

export type DecisionResult =
  | { ok: true; email: string; fullName: string | null }
  | { ok: false; error: string };

/**
 * Approve or decline one request, from either door.
 *
 * Approving does two things beyond marking the row: it stamps
 * principals.access_approved_at when the person already has an auth account
 * (they signed in once and were bounced), and it emails them the invitation. A
 * requester who has never signed in gets stamped by the auth gate itself on
 * first sign-in (enforceAccessGate's "grant" path).
 *
 * The decision token is always cleared, whichever door was used — that is what
 * makes an emailed link single-use, and it also retires the link the moment a
 * console decision lands.
 */
export async function applyAccessDecision(args: {
  id: string;
  decision: Extract<AccessRequestStatus, "approved" | "declined">;
  reviewerId: string | null;
  via: AccessDecisionRoute;
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
      decided_via: args.via,
      decision_token_hash: null,
      decision_token_expires_at: null,
    })
    .eq("id", args.id)
    .select("email, full_name")
    .maybeSingle();

  if (error || !updated) {
    if (error) console.error("[access-requests] decide failed:", error);
    return { ok: false, error: "Could not record that decision. Try again." };
  }

  const email = normalizeEmail(updated.email);
  if (args.decision !== "approved") {
    return { ok: true, email, fullName: updated.full_name };
  }

  // Exact match only — never ILIKE, whose `_` wildcard is a legal email
  // character and would widen an approval to accounts nobody approved. A
  // principal whose stored email differs in case simply isn't stamped here;
  // enforceAccessGate's "grant" path stamps them on their next sign-in instead.
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

  return { ok: true, email, fullName: updated.full_name };
}

/**
 * Record a decision made from the emailed link. The token is re-resolved here
 * rather than trusted from the confirmation page's hidden field, so the check
 * that matters — is this link still live? — runs at the moment of the write.
 */
export async function applyAccessDecisionByToken(args: {
  token: string;
  decision: Extract<AccessRequestStatus, "approved" | "declined">;
}): Promise<DecisionResult> {
  const request = await lookupDecisionToken(args.token);
  if (!request) {
    return { ok: false, error: "This link has expired or has already been used." };
  }
  return applyAccessDecision({
    id: request.id,
    decision: args.decision,
    // Nobody is signed in on this path; decided_via records the door instead.
    reviewerId: null,
    via: "email",
  });
}
