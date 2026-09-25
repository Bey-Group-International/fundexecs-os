// Platform ("super") admin gate — distinct from the org-scoped RBAC in
// lib/rbac.ts. An org admin runs THEIR firm; a platform admin sees the whole
// deployment: every signup, every org, cross-tenant traction. Access is gated
// to the internal email domain (@beygroupintl.com) plus an optional
// ADMIN_EMAILS allowlist so a one-off external operator can be granted access
// without a code change. The address must also be CONFIRMED: anyone can sign up
// as someone@beygroupintl.com, only the mailbox owner can confirm it.
//
// Platform admins also have unrestricted product access: they skip the plan
// feature gate (lib/feature-access) and the credit wall. The per-action sign-off
// on external sends (lib/terminal/action-contract) still applies to them.
//
// This gate is checked server-side in the /admin layout, in every admin API
// route, and to decide whether to show the Admin link in the sidebar. The
// cross-org reads themselves go through the service-role client, which never
// reaches the browser — so the ONLY thing standing between a normal user and
// every org's data is this check. Keep it strict.
import { getSessionContext, type SessionContext } from "@/lib/auth";

const ADMIN_DOMAIN = "beygroupintl.com";

function splitEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Emails explicitly allowlisted in addition to the internal domain. */
function adminAllowlist(): string[] {
  return splitEmails(process.env.ADMIN_EMAILS);
}

/**
 * True if `email` belongs to the internal domain or the ADMIN_EMAILS allowlist.
 * Case-insensitive; whitespace-tolerant. Returns false for anything malformed
 * so a blank or spoofed value can never pass.
 */
export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return false; // no local part or no domain
  const domain = normalized.slice(at + 1);
  if (domain === ADMIN_DOMAIN) return true;
  return adminAllowlist().includes(normalized);
}

/**
 * True if the signed-in user is a platform admin: an admin email that Supabase
 * has confirmed. Use this (not isPlatformAdminEmail) for any session-based check.
 */
export function isPlatformAdmin(
  user: { email: string | null | undefined; emailConfirmed: boolean } | null | undefined,
): boolean {
  return !!user && user.emailConfirmed === true && isPlatformAdminEmail(user.email);
}

/**
 * Where new-signup alerts are emailed. Prefers ADMIN_ALERT_EMAIL (one or more,
 * comma-separated), falls back to the ADMIN_EMAILS allowlist, and returns an
 * empty list when neither is set — in which case the alert is skipped rather
 * than sent to a guessed address.
 */
export function adminAlertRecipients(): string[] {
  const explicit = splitEmails(process.env.ADMIN_ALERT_EMAIL);
  if (explicit.length) return explicit;
  return adminAllowlist();
}

/**
 * Whether the current request's signed-in user is a platform admin. False
 * outside a request (cron, background work) or when signed out — so it can only
 * ever widen access for a confirmed admin, never for an unauthenticated caller.
 */
export async function currentUserIsPlatformAdmin(): Promise<boolean> {
  return isPlatformAdmin(await getSessionContext());
}

export type PlatformAdminGate =
  | { ok: true; ctx: SessionContext }
  | { ok: false; status: 401 | 403 };

/**
 * Resolve the session and confirm the caller is a platform admin. Returns a
 * typed reason so callers can map it: 401 (not signed in) vs 403 (signed in but
 * not a confirmed internal address). Use in admin API routes; the /admin layout uses the same gate
 * to redirect/404.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminGate> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, status: 401 };
  if (!isPlatformAdmin(ctx)) return { ok: false, status: 403 };
  return { ok: true, ctx };
}
