// lib/meetings/recognizer-policy.ts
// Whether this device should run speech recognition at all.
//
// Every participant's browser transcribes its own speaker for the whole call
// (transcript-buffer.ts). On an engine that honours `start(track)` that is one
// capture — the call's own echo-cancelled microphone — and a recognition
// stream. On an engine that ignores the track (Safari everywhere, Chromium
// before track support; see transcription-coverage.ts) it is a SECOND capture
// of the default microphone, raw, running beside the call's: two opens of the
// same device, the raw one unprocessed, and a continuous network recognition
// session for as long as the call lasts.
//
// On a laptop that is a cost worth paying for the transcript. On a phone it
// is not: the second capture weakens the echo cancellation the call depends
// on from a speakerphone, the recognition stream competes with the call for
// the one radio, and iOS pauses or re-routes the audio session underneath
// the call when a second capture starts. The member's words still reach the
// room — the coverage banner (coverageNotice) then tells the host they are
// reaching nobody's record, which is true and actionable.
//
// Desktop engines are unchanged: an engine that ignores the track still runs,
// with the "default microphone" notice saying what it is listening to.
//
// Pure: the room reads the user agent and the engine and passes the facts.

/**
 * Whether this is a phone or tablet, by user agent.
 *
 * iPadOS asks for the desktop site by default and reports a Macintosh user
 * agent, so a Mac with more than one touch point is an iPad — the same test
 * green-room.ts uses to pick permission instructions.
 */
export function isMobileUserAgent(userAgent: string | null | undefined, maxTouchPoints = 0): boolean {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return true;
  if (/Android/.test(ua)) return true;
  return /\bMobile\b|\bTablet\b/.test(ua);
}

export interface RecognizerPolicyFacts {
  /** From isMobileUserAgent. */
  mobile: boolean;
  /** Whether the engine honours `start(track)`. See engineFollowsTrack. */
  followsTrack: boolean;
}

/**
 * Why recognition is not being started here, or null to start it.
 *
 * Only the one case: a phone whose engine would open its own capture beside
 * the call's. A phone whose engine follows the track costs one capture like
 * a laptop and transcribes like one.
 */
export function recognizerSkipReason(facts: RecognizerPolicyFacts): string | null {
  if (facts.mobile && !facts.followsTrack) {
    return "this browser's recognizer would open a second microphone capture beside the call on a phone";
  }
  return null;
}

/**
 * What the member whose device skipped recognition is told, once.
 *
 * Says what still works before what does not: they can be heard, and the
 * meeting goes on without their words in the transcript. Names the remedy
 * rather than the mechanism.
 */
export const RECOGNIZER_SKIPPED_NOTICE =
  "Transcription is off on this phone — you can still be heard, but your words won't be in the transcript. "
  + "Join from a computer to be transcribed.";
