// Invite-only access control.
//
// FundExecs OS has no self-serve sign-up. A prospective operator submits an
// access request (app/request-access), a platform admin approves it in the
// admin console, and only then does a sign-in complete. The two halves live
// here so the auth paths (password sign-in and the OAuth callback) apply the
// SAME gate and can never drift apart.
//
// Server-only by construction: every read/write goes through the service-role
// client, which is never present in the browser bundle. The queue table also
// carries RLS with no policies, so a leaked anon key buys nothing.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { sendEmail, escapeHtml } from "@/lib/email";
import { adminAlertRecipients, isPlatformAdminEmail } from "@/lib/platform-admin";
import { SITE_URL } from "@/lib/site";

export type AccessRequestStatus = "pending" | "approved" | "declined";

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
  /** True when an auth user already exists for this email. */
  hasAccount: boolean;
}

/** Longest value we persist per free-text field — a form post is untrusted. */
const MAX_SHORT = 200;
const MAX_NOTE = 2000;

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

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string };

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
 * concurrent calls send exactly one message. Best-effort throughout — an email
 * hiccup must never fail the request the operator just submitted.
 */
async function notifyAccessRequestOnce(email: string): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { data: claimed, error } = await supabase
      .from("access_requests")
      .update({ alerted_at: new Date().toISOString() })
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
    });

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

interface AccessRequestEmailInput {
  email: string;
  fullName: string | null;
  firm: string | null;
  role: string | null;
  note: string | null;
  createdAt: string;
}

/** Internal new-access-request notification (dark, matches lib/email templates). */
export function accessRequestEmail(input: AccessRequestEmailInput): {
  subject: string;
  html: string;
} {
  const name = input.fullName?.trim() || input.email;
  const when = new Date(input.createdAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const rows: [string, string][] = [
    ["Name", input.fullName || "—"],
    ["Email", input.email],
    ["Firm", input.firm || "—"],
    ["Role", input.role || "—"],
    ["Requested", `${when} UTC`],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#888888;white-space:nowrap;">${escapeHtml(
          k,
        )}</td><td style="padding:6px 0;font-size:14px;color:#F5F5F5;">${escapeHtml(
          v,
        )}</td></tr>`,
    )
    .join("");

  const noteHtml = input.note
    ? `<p style="margin:20px 0 0;padding:12px;border-left:2px solid #F59E0B;background:#161616;font-size:14px;color:#DDDDDD;">${escapeHtml(
        input.note,
      )}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden;">
    <div style="padding: 6px 24px; background: #F59E0B;">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #0a0a0a; text-transform: uppercase;">FundExecs OS · Admin</span>
    </div>
    <div style="padding: 32px 24px;">
      <h1 style="margin: 0 0 8px; font-size: 20px; color: #F5F5F5; font-weight: 700;">Access request</h1>
      <p style="margin: 0 0 20px; font-size: 15px; color: #AAAAAA;"><strong style="color:#F5F5F5;">${escapeHtml(
        name,
      )}</strong> is asking for access to FundExecs OS.</p>
      <table style="width:100%; border-collapse:collapse; border-top:1px solid #222222; padding-top:8px;">
        ${rowsHtml}
      </table>
      ${noteHtml}
      <p style="margin: 24px 0 0; font-size: 13px; color: #888888;">Approve or decline in the <a href="${SITE_URL}/admin" style="color:#F59E0B;">admin console</a>.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject: `Access request: ${name}`, html };
}

/** Invitation email sent to a requester when a platform admin approves them. */
export function accessApprovedEmail(input: { fullName: string | null; email: string }): {
  subject: string;
  html: string;
} {
  const greeting = input.fullName?.trim()?.split(/\s+/)[0] || "there";
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #111111; border: 1px solid #222222; border-radius: 12px; overflow: hidden;">
    <div style="padding: 6px 24px; background: #F59E0B;">
      <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #0a0a0a; text-transform: uppercase;">FundExecs OS</span>
    </div>
    <div style="padding: 32px 24px;">
      <h1 style="margin: 0 0 8px; font-size: 20px; color: #F5F5F5; font-weight: 700;">You're in, ${escapeHtml(
        greeting,
      )}</h1>
      <p style="margin: 0 0 20px; font-size: 15px; color: #AAAAAA;">Your access to FundExecs OS is approved. Sign in with <strong style="color:#F5F5F5;">${escapeHtml(
        input.email,
      )}</strong> and we'll walk you through setting up your firm.</p>
      <a href="${SITE_URL}/login" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#F59E0B;color:#0a0a0a;font-size:14px;font-weight:700;text-decoration:none;">Sign in</a>
    </div>
  </div>
</body>
</html>`;

  return { subject: "Your FundExecs OS access is approved", html };
}
