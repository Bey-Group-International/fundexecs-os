// lib/crm/contact-match.ts
// Deciding which CRM contact a name or an address belongs to.
//
// Extracted here when the inbox became the second thing that needed it. It was
// written for meetings, and "lib/meetings owns the rule lib/inbox depends on" is
// the wrong shape — the rule belongs to the CRM, and both sides of the product
// are consumers of it.
//
// The rule itself is unchanged and deliberately dull: EXACT addresses only. A
// wrong link writes one person's conversation onto another person's permanent
// record, org-wide, and nothing downstream can tell it was wrong. An unmatched
// address stays unlinked and can be attached by hand, which is recoverable; a
// wrong link is silently wrong forever.
//
// Pure: no database, no clock, no network.

/** Lowercased address → contact id, built by the caller in one query. */
export type EmailIndex = ReadonlyMap<string, string>;

/**
 * An address, or "" when it is not one.
 *
 * Case and surrounding space are ignored because those are not differences.
 * Everything else is: no domain guessing, no name similarity, no "close
 * enough".
 */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) return "";
  const at = trimmed.indexOf("@");
  // Exactly one @, with something either side of it.
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at === trimmed.length - 1) return "";
  // A domain has to have a dot in it, and cannot end on one.
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return "";
  return trimmed;
}

/** The contact holding exactly this address, or null. */
export function contactForEmail(index: EmailIndex, value: unknown): string | null {
  const email = normalizeEmail(value);
  if (!email) return null;
  return index.get(email) ?? null;
}

/**
 * Text cut to a length the timeline can hold, with a marker when it was cut.
 *
 * A contact's record is for seeing at a glance what happened with somebody, not
 * a second copy of the conversation.
 */
export function boundedBody(text: string, max: number): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}
