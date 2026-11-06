// Which organization a signed-in person is working in.
//
// People can belong to several organizations. Their choice is kept in a cookie,
// but the cookie is only a preference: it is checked against the memberships
// the database returned for this person on every request, so a stale, edited or
// forged value can never select an organization they do not belong to. When the
// cookie is missing or invalid the oldest membership wins, which is what the app
// did before switching existed.

export const ACTIVE_ORG_COOKIE = "fx_active_org";

/** One year. The cookie is a convenience, not a credential. */
export const ACTIVE_ORG_MAX_AGE = 60 * 60 * 24 * 365;

export interface MembershipLike {
  organization_id: string;
}

/**
 * Pick the active membership. `memberships` must already be ordered oldest
 * first (the fallback); `preferred` is the raw cookie value, if any.
 */
export function pickActiveMembership<T extends MembershipLike>(
  memberships: readonly T[],
  preferred: string | null | undefined,
): T | null {
  if (memberships.length === 0) return null;
  if (preferred) {
    const match = memberships.find((m) => m.organization_id === preferred);
    if (match) return match;
  }
  return memberships[0];
}
