// lib/meetings/follow-up-greeting.ts
// Who the follow-up greets.
//
// Split from follow-up.ts because the report page's panel needs the token too,
// and follow-up.ts imports the mailer.
//
// Pure: no database, no DOM.

/**
 * Where each recipient's first name goes.
 *
 * The report writes one follow-up and it goes to several people, so the model
 * is told to open on this token rather than on anybody's name. Left to choose a
 * name itself it chose badly: it was handed a flat list of participants with the
 * host first, and greeted the host by name — the person sending it. Filling the name
 * in per recipient, at the moment of sending, is what lets one draft greet each
 * reader as themselves.
 */
export const FIRST_NAME_TOKEN = "{{first_name}}";

/** Tolerates the spacing and case a hand edit might give the token. */
const FIRST_NAME_PATTERN = /\{\{\s*first_name\s*\}\}/gi;

/**
 * "Hi Maria," / "Dear Ms. Chen —" at the very top of a draft.
 *
 * A dash only ends the name when it stands apart from it, so "Simmons-Bey" is
 * read as one name rather than as "Simmons" followed by punctuation.
 */
const GREETING_PATTERN =
  /^(\s*(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\s+)([^,!:\n]+?)(\s*[,!:]|\s+[—–-](?=\s))/i;

/**
 * The name to greet somebody by.
 *
 * Empty when there is not one worth using: an address standing in for a name,
 * or nothing at all. "Chen, Maria" is read as surname-first, because that is
 * how directories export it.
 */
export function firstNameOf(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean || clean.includes("@")) return "";
  const parts = clean.split(",");
  const given = parts.length === 2 && parts[1].trim() ? parts[1].trim() : clean;
  return given.split(/\s+/)[0] ?? "";
}

function sameName(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || firstNameOf(x) === firstNameOf(y);
}

/**
 * One recipient's copy of the follow-up.
 *
 * The token is replaced with their first name — "there" when they have none.
 *
 * And a guard for drafts written before the token existed, or edited by hand
 * back into a name: a greeting that names the HOST is rewritten to name the
 * recipient instead. That is the exact failure this exists to stop — a report
 * addressed to the person who ran the meeting, sent to everyone else in it — and
 * the stored drafts that already carry it should not go out that way either.
 * Any other greeting is the host's own wording and is left alone.
 */
export function personalizeFollowUp(
  body: string,
  recipientName: string | null | undefined,
  options: { hostName?: string | null } = {},
): string {
  const greet = firstNameOf(recipientName) || "there";
  if (new RegExp(FIRST_NAME_PATTERN.source, "i").test(body)) {
    return body.replace(FIRST_NAME_PATTERN, greet);
  }
  const host = (options.hostName ?? "").trim();
  const match = GREETING_PATTERN.exec(body);
  if (!host || !match || !sameName(match[2], host)) return body;
  return body.replace(GREETING_PATTERN, `$1${greet}$3`);
}

/**
 * The draft for a reader who is not a recipient: an export, a copy to the
 * clipboard. The token reads as a placeholder rather than as template syntax.
 */
export function displayFollowUp(body: string): string {
  return body.replace(FIRST_NAME_PATTERN, "[First name]");
}
