// Shape of the free-text profile fields a member controls on Build > Team.

/** Upper bound on a member bio, enforced in the textarea and again server-side. */
export const MAX_BIO_LENGTH = 600;

/**
 * Normalize a submitted bio: trim, collapse the runs of blank lines a paste
 * from a PDF or a deck usually carries, and clamp to MAX_BIO_LENGTH.
 * Returns null for an empty bio so the column stays null rather than "".
 */
export function normalizeBio(raw: unknown): string | null {
  const text = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.slice(0, MAX_BIO_LENGTH);
}
