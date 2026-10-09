// lib/meetings/transcription-coverage.ts
// Whether everyone in the room is actually being transcribed — and what to say
// when somebody is not.
//
// The transcript's ownership rule is "each device transcribes its own speaker":
// a participant's words reach the record only through their own browser's
// speech recognition (see transcript-buffer.ts and speaker-attribution.ts, and
// the attribution rule that deliberately DROPS a peer's voice heard through the
// speakers, because "their own client is transcribing it"). The rule is what
// keeps one sentence from being stored three times — and it rests on an
// assumption nobody ever checked: that every browser in the call HAS working
// recognition. It does not. Firefox ships none; an engine can refuse to start;
// and an engine that ignores the track it is handed can sit deaf on the wrong
// microphone for the whole call.
//
// Until now each of those failed privately. The member it happened to saw a
// notice at best — on Firefox, nothing at all — while every other participant,
// including the host who will read the report, had no idea that one person's
// words were reaching nobody's record. The meeting ended, the report read as
// though a colleague had sat in silence, and there was never a moment at which
// anyone could have fixed it.
//
// So each client tells the room whether its own transcription is working, and
// the room says plainly whose words are not being kept — while the meeting is
// still running, which is the only time it can be acted on.
//
// Pure: no React, no sockets. The room supplies the states and the names.

/**
 * The room's own recognition lifecycle, as MeetingRoom tracks it.
 *
 * "failing" is an engine that keeps dying and is still being restarted — a
 * network error on every run, or runs that end as soon as they start. It is
 * not "error" (the room has not given up) and it is not "active" (nobody is
 * being transcribed). See recognizerStatusAfterEnd.
 */
export type SrStatus = "idle" | "active" | "failing" | "error" | "unsupported";

/**
 * What this client should tell the room about its own transcription.
 *
 * "idle" counts as transcribing: it is a recognizer waiting for a microphone,
 * and a member with no live microphone has no words to miss — calling them
 * uncovered would raise the banner against every participant who joined muted.
 * "active" counts only while the deaf watch is quiet: an engine that answers
 * nothing while its owner audibly talks is transcribing nobody, whatever its
 * status says.
 *
 * And only while the words it produces are being SAVED. Transcribing into a
 * buffer whose every flush is refused is transcribing for nobody but the
 * member's own screen; the report will not have it. `saving` is the room's
 * save-failure state (transcript-saving.ts), true by default.
 */
export function localTranscribing(status: SrStatus, deaf: boolean, saving = true): boolean {
  if (status === "unsupported" || status === "error" || status === "failing") return false;
  if (!saving) return false;
  return !deaf;
}

/**
 * Whether this engine follows the microphone track it is handed.
 *
 * `recognition.start(track)` is a real argument only on engines that shipped
 * MediaStreamTrack support for the Web Speech API. Every earlier engine —
 * Chrome and Edge for years, Safari to this day — accepts the call and
 * SILENTLY IGNORES the argument, opening its own capture of the computer's
 * default microphone instead. There is no way to ask "did you honour that
 * argument", so the test is the API surface that shipped beside it: the same
 * Chromium work gave `SpeechRecognition` its static `available()` (the
 * on-device recognition query), and no engine has one without the other.
 *
 * The rule this replaces guessed by BROWSER BRAND — "Safari ignores the
 * track, Chrome follows it" — which was wrong for every Chrome and Edge that
 * predates track support: a member there on a conference microphone was heard
 * by the room through it and transcribed from the laptop's own mic across the
 * table, with words missing and garbled from the first sentence and other
 * people's speech landing under their name — and the notice that exists for
 * exactly this told them nothing, because their browser was not Safari.
 */
export function engineFollowsTrack(sr: unknown): boolean {
  return typeof (sr as { available?: unknown } | null | undefined)?.available === "function";
}

/** What the notice needs to know about the recognizer's real input. */
export interface RecognizerMicFacts {
  /**
   * The recognizer's own state. A browser with no engine at all, one that
   * refused to run, or one that keeps dying is transcribing from NO
   * microphone — the coverage banner owns that story, and a warning about
   * which microphone a non-existent recognizer listens to is nonsense.
   */
  status: SrStatus;
  /** Whether the engine honours `start(track)`. See engineFollowsTrack. */
  followsTrack: boolean;
  /** The device chosen for the call; "" or "default" IS the default. */
  micId: string;
  /** The chosen device's human name, for the notice. */
  micLabel?: string | null;
  /** The chosen track's physical-device group, where the browser reports one. */
  micGroupId?: string | null;
  /** The system default input's group, from enumerateDevices(). */
  defaultGroupId?: string | null;
}

/**
 * What to tell a member whose transcription is listening to the wrong
 * microphone.
 *
 * On an engine that ignores the handed track, the recognizer captures the
 * computer's DEFAULT input whatever the call uses. Said at the moment a
 * different microphone is picked, which is the moment it can be acted on;
 * withdrawn when the choice is the default again.
 *
 * The group comparison is what keeps it honest in the other direction: a
 * member who picked the default device BY ITS CONCRETE ID — the same physical
 * microphone, just not the "default" alias — has the recognizer and the call
 * on one device, and warning them would teach everyone to dismiss the real
 * warning. When either group is unknown the comparison stands down and the
 * notice shows: the cost of a spare warning is a dismissal, the cost of a
 * missing one is a meeting transcribed from the wrong side of the room.
 */
export function transcriptionMicNotice(facts: RecognizerMicFacts): string | null {
  if (facts.status !== "active" && facts.status !== "idle") return null;
  if (facts.followsTrack) return null;
  if (!facts.micId || facts.micId === "default") return null;
  const chosen = (facts.micGroupId ?? "").trim();
  const dflt = (facts.defaultGroupId ?? "").trim();
  if (chosen && dflt && chosen === dflt) return null;
  const label = facts.micLabel?.trim();
  const name = label ? `“${label}”` : "the microphone you picked";
  return `This browser transcribes from your computer's default microphone, not ${name}. `
    + `Your words may be missing or wrong in the transcript until ${name} is made the `
    + `default microphone in your system's sound settings.`;
}

/**
 * The banner the rest of the room sees, or null while everyone is covered.
 *
 * Names the people rather than counting them — "2 participants" sends the host
 * checking tiles one by one — and names the consequence before the remedy,
 * because the consequence is the part nothing else in the product will ever
 * surface: those words are not in the transcript and will not be in the report,
 * verbatim or otherwise.
 */
export function coverageNotice(names: readonly string[]): string | null {
  const clean: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name && !clean.includes(name)) clean.push(name);
  }
  if (clean.length === 0) return null;
  const who = clean.length === 1
    ? clean[0]
    : `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
  const verb = clean.length === 1 ? "isn't" : "aren't";
  const browser = clean.length === 1 ? "Their browser" : "Their browsers";
  return `${who} ${verb} being transcribed, so their words are not reaching the transcript or the report. `
    + `${browser} can't transcribe or can't hear them — Chrome, Edge or Safari with a working microphone fixes it.`;
}
