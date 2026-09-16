// lib/log-safe.ts
// Putting an untrusted value in a log line without letting it write its own.
//
// Ids, names and addresses reach us from request bodies and URLs, and several
// of them end up in `console.error` next to an explanation of what went wrong.
// A value carrying a newline does not merely look untidy there: it ends the
// line, and whatever follows is read by every log viewer, alert rule and
// aggregator as a separate entry that this process appears to have written.
// That is how a forged "sync completed" or an invented stack trace gets into
// an incident timeline.
//
// Pure, and deliberately blunt — a log line is for reading, so anything that
// could be a control character becomes a visible marker rather than vanishing.

/** Longest a single interpolated value may be before it is cut. */
export const MAX_LOG_VALUE = 200;

/** The visible stand-in for a control character (␚). */
const MARKER = "␚";

/**
 * An untrusted value, safe to interpolate into one log line.
 *
 * Control characters are replaced rather than stripped: a value that contained
 * them is worth seeing as such, and a silent strip would make "abc\ndef" and
 * "abcdef" look identical in the one place somebody is trying to work out what
 * actually happened.
 */
export function logSafe(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (value === null || value === undefined) text = String(value);
  else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    text = String(value);
  } else {
    // Objects are not rendered: `String({})` is "[object Object]", which tells
    // a reader nothing and hides whatever the caller meant to show.
    text = "[unprintable]";
  }

  const flattened = text.replace(/[\u0000-\u001f\u007f]/g, MARKER);
  return flattened.length > MAX_LOG_VALUE ? `${flattened.slice(0, MAX_LOG_VALUE)}…` : flattened;
}
