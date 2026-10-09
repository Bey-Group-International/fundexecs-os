// lib/meetings/transcript-saving.ts
// Telling a member when their words are not reaching the record.
//
// Each client saves only its own lines (transcript-buffer.ts), so a save that
// keeps failing on one device loses that one person's half of the meeting —
// and until now it lost it silently. A 401 (the session expired an hour into
// the call) or a 403 (the attendance row never got written, so the route's
// participant check refuses) was retried every thirty seconds for the rest of
// the meeting, each attempt refused identically, while the room's coverage
// banner told everyone this person was covered. "RLS cannot fail loudly; a
// route can" (AGENT.md) was only half honoured: the route failed loudly and
// the client swallowed it.
//
// Pure: the room supplies the count of consecutive failures and the last HTTP
// status it saw.

/**
 * How many consecutive failures before the member is told.
 *
 * One is a blip: a request that collided with a Wi-Fi roam retries in thirty
 * seconds and succeeds. Three in a row is a minute and a half of nothing
 * saved, and whatever it is, it is not going to fix itself unnoticed.
 */
export const SAVE_FAILURES_BEFORE_NOTICE = 3;

/** Whether this client's words are currently reaching the record. */
export function savesCovered(consecutiveFailures: number): boolean {
  return consecutiveFailures < SAVE_FAILURES_BEFORE_NOTICE;
}

/**
 * What to tell the member, or null while there is nothing worth saying.
 *
 * An auth refusal gets the remedy that works — rejoin, which is a fresh
 * session and a fresh attendance row — rather than a vague "saving failed".
 * Anything else is named as a saving problem that is still being retried,
 * because it may well recover and the member can do nothing about it but
 * know.
 */
export function saveFailureNotice(consecutiveFailures: number, lastStatus: number | null): string | null {
  if (savesCovered(consecutiveFailures)) return null;
  if (lastStatus === 401 || lastStatus === 403) {
    return "Your words aren't being saved to the transcript — your session has expired or the room no longer recognises you. "
      + "Leave and rejoin to be recorded again; the call itself is fine.";
  }
  return "Your words aren't reaching the transcript right now. The room keeps trying; "
    + "if this stays up, your side of the meeting won't be in the report.";
}
