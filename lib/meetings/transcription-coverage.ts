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

import type { BrowserFamily } from "@/lib/meetings/green-room";

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
 * What to tell a member who picked a microphone the engine will not follow.
 *
 * Safari's recogniser ignores the track it is handed and transcribes the
 * computer's DEFAULT input, whatever the call is using. A host who picks a
 * conference microphone there is heard by the room through it and transcribed
 * from the laptop's own mic across the table — and until the deaf watch fires
 * (which it does only when the default hears nothing at all) nobody says so.
 * This says so at the moment of the choice, which is the moment they can
 * change the default.
 *
 * `micId` is the chosen device; an empty id or "default" IS the default, and
 * nothing need be said. Null when the browser is one whose engine follows the
 * track.
 */
export function transcriptionMicNotice(browser: BrowserFamily, micId: string): string | null {
  if (browser !== "safari" && browser !== "ios-safari") return null;
  if (!micId || micId === "default") return null;
  return "Safari transcribes from your computer's default microphone, not the one you picked for the call. "
    + "To be transcribed from this microphone, make it the default in System Settings → Sound.";
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
