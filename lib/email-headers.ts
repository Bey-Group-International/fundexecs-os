// lib/email-headers.ts
// Turning arbitrary text into MIME header values that cannot break out of the
// header they belong to.
//
// A header ends at a CRLF. So any value interpolated into one — a subject, a
// display name, an attachment filename — is a chance for its author to end the
// header early and start writing their own. `Bob\r\nBcc: attacker@evil.test`
// in a name field is a Bcc on somebody else's mail. Nothing upstream can be
// relied on to have stripped it: the public booking form only requires that a
// name be non-empty, and `.trim()` does not touch the interior of a string.
//
// Two rules, applied here so no caller has to remember them:
//
//   1. Control characters never reach a header. CR and LF are the injection
//      itself; the rest of C0/C1 have no meaning in a header and some clients
//      resynchronize on them.
//   2. Anything non-ASCII is encoded, not passed through. RFC 5322 headers are
//      ASCII; raw UTF-8 renders as mojibake in some clients, and "encode it"
//      is the same answer as "make it safe".
//
// Nothing here throws or rejects — lib/email.ts promises callers that sending
// degrades rather than fails, and a mangled subject still delivers a message a
// human can act on. Sanitizing is silent on purpose.

/** Characters that must never appear in a header value: C0, DEL, and C1. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * A header value stripped of everything that could end the header early.
 *
 * Control characters become spaces rather than vanishing, so `A\r\nB` reads as
 * `A B` instead of the single word `AB` — a folded header and a joined word
 * look very different to whoever reads the mail. Runs collapse, because a
 * CRLF pair would otherwise leave two.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** True when every character is printable US-ASCII and needs no encoding. */
function isPrintableAscii(value: string): boolean {
  return !/[^\u0020-\u007E]/.test(value);
}

// An RFC 2047 encoded-word must be at most 75 characters INCLUDING its
// `=?UTF-8?B?` prefix and `?=` suffix, which leaves 63 for the base64 payload.
// Base64 comes in 4-character groups, so 60 characters — 45 bytes of input.
const MAX_BYTES_PER_WORD = 45;

/**
 * RFC 2047 encoded-words for one value, split so each stays within the limit.
 *
 * The split is by whole characters rather than bytes: every encoded-word has
 * to decode on its own, so a multi-byte character may not straddle two of
 * them. Words are joined by a fold (CRLF + space), which decoders unfold and
 * concatenate without the whitespace — the standard way to carry a long
 * encoded value.
 */
function encodeWords(value: string): string {
  const words: string[] = [];
  let chunk = "";
  let bytes = 0;

  // Iterating the string yields whole code points, so surrogate pairs stay
  // together; combining marks may split, which decoders recombine on join.
  for (const ch of value) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > MAX_BYTES_PER_WORD) {
      words.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += ch;
    bytes += size;
  }
  if (chunk) words.push(chunk);

  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

/**
 * Text safe to place after `Header-Name: `.
 *
 * Plain ASCII passes through unchanged so the common case stays readable in
 * the raw message; anything else is encoded whole rather than word by word,
 * which avoids the ambiguity of a header that mixes encoded and literal runs.
 */
export function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeaderValue(value);
  return isPrintableAscii(clean) ? clean : encodeWords(clean);
}

/** Characters that end or re-point an address rather than naming one. */
const ADDRESS_UNSAFE = /[<>,;:\\"\s]/g;

/**
 * An addr-spec that cannot carry anything but itself.
 *
 * Angle brackets, comma and semicolon would add recipients; whitespace and
 * quotes would end the address. Stripping them can leave a nonsense address,
 * which Gmail rejects with a clear error — the right outcome, and far better
 * than a well-formed address that is not the one the caller asked for.
 */
export function sanitizeAddress(email: string): string {
  return sanitizeHeaderValue(email).replace(ADDRESS_UNSAFE, "");
}

/** Specials that force a display name to be quoted, per RFC 5322 §3.2.3. */
const PHRASE_SPECIALS = /[()<>[\]:;@\\,."]/;

/**
 * One `Name <addr>` mailbox, with the name made safe for the phrase position.
 *
 * Three cases: a plain phrase needs nothing, a phrase containing specials is
 * quoted with its quotes and backslashes escaped, and a non-ASCII phrase is
 * encoded — an encoded-word is already free of specials, so it never also
 * needs quoting. A name that sanitizes away to nothing yields the bare
 * address, since `<a@b.test>` with an empty phrase is legal but reads oddly.
 */
export function formatMailbox(name: string, email: string): string {
  const address = sanitizeAddress(email);
  const clean = sanitizeHeaderValue(name);
  if (!clean) return address;

  if (!isPrintableAscii(clean)) return `${encodeWords(clean)} <${address}>`;
  if (PHRASE_SPECIALS.test(clean)) {
    return `"${clean.replace(/([\\"])/g, "\\$1")}" <${address}>`;
  }
  return `${clean} <${address}>`;
}

/**
 * A MIME parameter value for a quoted context, such as a filename.
 *
 * Quotes and backslashes would end the parameter or escape past it. These are
 * dropped rather than escaped: the value names a file the recipient will see,
 * and a filename is not worth the compatibility risk of backslash escapes,
 * which clients disagree about.
 */
export function sanitizeMimeParam(value: string): string {
  return sanitizeHeaderValue(value).replace(/["\\]/g, "");
}
