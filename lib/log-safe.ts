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
// There are two separate problems here, and the second is the one that is easy
// to miss. A value in the FIRST argument to console.error is the format string,
// so a "%s" in it swallows the next argument — which is how a caller's id can
// rewrite the rest of the line even with every newline stripped out of it. So
// the rule this module exists to make easy is: the message is a constant, and
// the untrusted value goes through here and travels as an argument.

/**
 * An identifier, or a marker saying it was not one.
 *
 * An allowlist rather than an escape. Every id this application logs is a UUID
 * or a room code — letters, digits, dashes and underscores — so anything else
 * is not an id that got mangled, it is a value that has no business being one,
 * and printing a scrubbed version of it would only make it look plausible.
 *
 * This is also the difference between "we removed the newlines" and "nothing
 * but an id can get through", which is the property worth having: it holds
 * whatever a future caller passes, and whatever a future attacker sends.
 */
export function logId(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "[invalid-id]";
}
