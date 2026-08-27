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
import { resolveGmailToken } from "@/lib/email";
import {
  grantCanSend,
  problemFromTokenError,
  type MailboxProblem,
  type MailboxSource,
} from "@/lib/meetings/mailbox";

type ServiceClient = SupabaseClient<Database>;

export type MailboxResolution =
  | { ok: true; token: string; email: string | null; source: MailboxSource }
  | { ok: false; problem: MailboxProblem };

/**
 * A Gmail token to send this member's meeting email through, or the reason
 * there isn't one.
 *
 * Tries every Google grant the app already holds before asking anyone to
 * authorize anything. There are two that can send, and a member who has done
 * either should not be sent back to a consent screen:
 *
 *   1. The member's OWN grant, in google_calendar_connections. Preferred,
 *      because the message then carries their address.
 *   2. The organization's connected Google integration (Settings ›
 *      Integrations), whose scope is gmail.send by construction. Authorized by
 *      one member on the org's behalf, so the address is a real person's — just
 *      not necessarily this one's, which is why the source is reported back
 *      rather than passed off as the caller's own.
 *
 * Never throws. A refusal means neither exists.
 */
export async function mailboxFor(
  client: ServiceClient,
  userId: string,
  orgId?: string,
): Promise<MailboxResolution> {
  const own = await memberMailbox(client, userId);
  if (own.ok) return own;

  // Fall through to the org integration before refusing. Requiring a fresh
  // grant from someone whose organization already connected Google is asking
  // twice for a permission the app is holding.
  if (orgId) {
    try {
      const token = await resolveGmailToken({ orgId });
      if (token) return { ok: true, token, email: null, source: "organization" };
    } catch {
      // A broken org lookup must not mask the member-level reason below.
    }
  }

  return own;
}

/** The member's own grant, with the reason when there isn't a usable one. */
async function memberMailbox(
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

  return { ok: true, token: token.data, email: conn.google_email, source: "member" };
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
  orgId?: string,
): Promise<{ gmailAccessToken: string } | undefined> {
  if (!userId) return undefined;
  const mailbox = await mailboxFor(client, userId, orgId);
  return mailbox.ok ? { gmailAccessToken: mailbox.token } : undefined;
}
