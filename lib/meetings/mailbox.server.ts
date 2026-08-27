// lib/meetings/mailbox.server.ts
// Resolving a member's own mailbox to send from.
//
// The grant lives in google_calendar_connections — one row per member, holding
// an encrypted refresh token and the Google address it belongs to. That table
// was built for calendar sync; sending reuses it rather than asking the same
// member to authorize the same Google account twice.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { accessTokenFor, type ConnectionRow } from "@/lib/calendar/google.server";
import {
  grantCanSend,
  problemFromTokenError,
  type MailboxProblem,
} from "@/lib/meetings/mailbox";

type ServiceClient = SupabaseClient<Database>;

export type MailboxResolution =
  | { ok: true; token: string; email: string | null }
  | { ok: false; problem: MailboxProblem };

/**
 * A short-lived Gmail token for this member, or the reason there isn't one.
 *
 * Never throws and never falls back to another mailbox: a caller that asked to
 * send as a particular person must not quietly send as somebody else. The
 * reason it returns is the thing the member is shown.
 */
export async function mailboxFor(
  client: ServiceClient,
  userId: string,
): Promise<MailboxResolution> {
  const { data, error } = await client
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // supabase-js resolves with { error } rather than throwing. A failed lookup
  // is not "no mailbox" — saying so would send a member to reconnect an
  // account that is already connected.
  if (error) return { ok: false, problem: "unavailable" };
  if (!data) return { ok: false, problem: "not_connected" };

  const conn = data as unknown as ConnectionRow & { granted_scope: string | null };
  if (!grantCanSend(conn.granted_scope)) return { ok: false, problem: "scope_missing" };

  const token = await accessTokenFor(conn);
  if (!token.ok || !token.data) {
    return { ok: false, problem: problemFromTokenError(token.error) };
  }

  return { ok: true, token: token.data, email: conn.google_email };
}

/**
 * Credentials for a host's mailbox, or undefined when there isn't one.
 *
 * For the flows that must not be blocked by a missing connection: a booking
 * confirmation an anonymous visitor triggered, where refusing would leave them
 * with no confirmation at all, and a reschedule notice the guest needs whether
 * or not the host has authorized sending. Returning undefined falls the caller
 * through to the org mailbox, which is what happened before any of this.
 *
 * The interactive paths use mailboxFor instead, so the member is told why.
 */
export async function hostCredentials(
  client: ServiceClient,
  userId: string | null | undefined,
): Promise<{ gmailAccessToken: string } | undefined> {
  if (!userId) return undefined;
  const mailbox = await mailboxFor(client, userId);
  return mailbox.ok ? { gmailAccessToken: mailbox.token } : undefined;
}
