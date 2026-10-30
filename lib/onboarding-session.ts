// A principal who has authenticated but has no organization yet is mid-signup.
// They must never be left parked in that state: if they stop, the session is
// ended and they start over from the login page.

/** How long a no-org session may sit before it counts as abandoned. */
export const ONBOARDING_MAX_AGE_MS = 30 * 60 * 1000;

/** Where to send an abandoned, org-less session so it is signed out. */
export const ONBOARDING_RESET_PATH = "/auth/reset";

/**
 * True when the session signed in longer ago than the onboarding window. An
 * unknown sign-in time is treated as fresh: never evict on missing data.
 */
export function isOnboardingStale(
  lastSignInAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastSignInAt) return false;
  const signedInAt = Date.parse(lastSignInAt);
  if (!Number.isFinite(signedInAt)) return false;
  return now - signedInAt > ONBOARDING_MAX_AGE_MS;
}
