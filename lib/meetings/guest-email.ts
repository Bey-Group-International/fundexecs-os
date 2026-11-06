// lib/meetings/guest-email.ts
// The optional email a guest gives on the join screen.
//
// Optional and self-asserted: it is where the guest asked to be sent the
// follow-up, not proof of who they are. So the rule here is only "is this
// plausibly an address", never "is it theirs" — and anything that is not is
// treated as no address rather than refused, because a typo must never stop
// somebody joining a call.

/** A plausible email, lower-cased and trimmed; null for anything else. */
export function cleanGuestEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  // One @, something either side, a dot in the domain, no spaces.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
