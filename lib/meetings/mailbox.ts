// lib/meetings/mailbox.ts
// Whose mailbox a meeting email goes out from, and what to say when there
// isn't one.
//
// Outbound mail used to resolve one Gmail grant per ORGANIZATION. That is the
// wrong shape for meeting email: a reminder, an invitation and a cancellation
// are all sent by a person, and the guest should see that person's address —
// not a shared mailbox, and not nothing at all, which is what an org with no
// connection got.
//
// The grant that carries this is the per-user one in
// google_calendar_connections. It already existed for calendar sync, which is
// why the send side needs no new table: it needs the gmail.send scope added to
// the same grant, and a reason to hand back when a member has not granted it.
//
// Pure. The lookup and the token mint live in mailbox.server.ts.

/** Which connection a send went out through. */
export type MailboxSource =
  /** The member's own Google grant — their address on the message. */
  | "member"
  /** The organization's connected Google integration, authorized by someone else. */
  | "organization";

/** Why a member's mailbox cannot send right now. */
export type MailboxProblem =
  /** No Google grant at all for this member. */
  | "not_connected"
  /** Connected before sending was part of the grant, so the scope is missing. */
  | "scope_missing"
  /** The grant was revoked, or the password changed. Google says invalid_grant. */
  | "revoked"
  /** Google could not be reached, or answered with something unusable. */
  | "unavailable";

/** The scope a grant needs before Gmail will accept a send from it. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/**
 * Whether a stored grant carries the send scope.
 *
 * `granted_scope` is what Google actually returned, not what was asked for —
 * the two differ when a member unticks a permission on the consent screen, and
 * a member who connected before sending was added has calendar and nothing
 * else. Reading it lets the refusal say "reconnect" rather than "connect",
 * which is the difference between a member finding the button and not.
 */
export function grantCanSend(grantedScope: string | null | undefined): boolean {
  if (!grantedScope) return false;
  return grantedScope.split(/\s+/).some((s) => s === GMAIL_SEND_SCOPE);
}

/**
 * What to tell the member. Each names the action that fixes it, because
 * "could not send" on its own leaves them nowhere to go.
 *
 * Each also names BOTH ways out. There is more than one Google grant in this
 * app — the per-user calendar one and the org-level integration — and either
 * can send. Naming only the one the member happens to be missing would send
 * somebody to re-authorize an account they had already connected elsewhere.
 */
export function mailboxProblemMessage(problem: MailboxProblem): string {
  switch (problem) {
    case "not_connected":
      return "No Google account is connected. Connect one in Settings › Integrations, or connect your calendar, and meeting email will send from it.";
    case "scope_missing":
      return "Reconnect your Google account to allow sending — the current connection covers your calendar but not email. Connecting Google in Settings › Integrations works too.";
    case "revoked":
      return "Your Google connection was revoked. Reconnect it to send from your address.";
    case "unavailable":
      return "Could not reach Google to send from your address. Try again shortly.";
  }
}

/**
 * Read a token-mint failure as a problem the member can act on.
 *
 * Google reports a revoked grant and a changed password the same way, as
 * invalid_grant, and both are fixed by reconnecting. Anything else is
 * transient as far as the member is concerned.
 */
export function problemFromTokenError(error: string | null | undefined): MailboxProblem {
  return /invalid_grant/i.test(error ?? "") ? "revoked" : "unavailable";
}
