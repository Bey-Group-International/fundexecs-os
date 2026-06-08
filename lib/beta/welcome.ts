/**
 * Shared bits for the beta welcome experience (the AI-led claim journey at
 * /beta/claim). Client- and server-safe — no `server-only` import.
 */

/** Cookie carrying the pre-auth "application" answers across sign-in so
 *  onboarding can resume from them. Set client-side before auth, read +
 *  cleared by /beta/claim/complete. Not security-sensitive. */
export const BETA_APPLICATION_COOKIE = 'fx-beta-application';

export interface BetaApplication {
  /** Display name the visitor typed. */
  name?: string;
  /** A `MemberType` value (validated server-side before use). */
  memberType?: string;
  /** One-line goal / what they want out of the program. */
  goal?: string;
}

/**
 * Safe, public-facing context for personalizing the claim welcome — resolved
 * server-side from the link token. Never carries anything sensitive: just the
 * admin's link label and the inviter's display name, both shown to the invitee.
 */
export interface BetaInviteContext {
  /** Admin-set link label, e.g. "Wave 2 LPs" (null when unlabeled). */
  label: string | null;
  /** Display name of whoever minted the link, for "Invited by …". */
  inviterName: string | null;
}
