/**
 * The note `formatTranscriptLine` writes against a line the engine scored below
 * the floor.
 *
 * Written into the record rather than used to delete from it. A reader of the
 * transcript is better served by "this was not recognised reliably" than by a
 * silent gap, and it is what lets the model's copy be taken from the merged
 * text — the only text that has every line, since neither the room's copy nor
 * the stored rows are a superset of the other.
 *
 * It MUST begin with "uncertain". `parseTranscript` reads a parenthetical as a
 * confidence note only when it does, and treats any other parenthetical as part
 * of the speaker's name — so "Rae (Acme)", a name a guest typed at the door,
 * stays their name. A note worded otherwise slips under that rule's word and
 * length limits and becomes a SPEAKER: every noise line of Alina's would be
 * filed under a second person called "Alina (not recognised reliably)",
 * splitting her turns, her colour and her initials, and marked not doubtful at
 * all. Verified by running it, not assumed; see transcript-quality.test.ts,
 * which crosses the two modules because neither one's own tests can see this.
 */
export const NOISE_NOTE = "uncertain — not recognised reliably";

/**
 * Why a rendered line is kept out of the model's reading, or null.
 *
 * One rule, read by both the filter and the gauge, so what is counted and what
 * is removed can never disagree. The note is read from the speaker LABEL only —
 * a sentence about transcription quality is not noise.
 */
function withheldLine(line: string): WithheldReason | null {
  const colon = line.indexOf(":");
  const label = colon === -1 ? "" : line.slice(0, colon);
  const said = colon === -1 ? line : line.slice(colon + 1);
  if (label.includes(NOISE_NOTE)) return "noise";
  if (isAssistantWakeLine(said)) return "assistant";
  return null;
}

// lib/meetings/transcript-quality.ts
// What the report model is allowed to read, and whether there is enough of it.
//
// Read against the Gary Jinks meeting: 64 minutes between two people whose
// transcript is noise recognised as words — "Shah Rukh Khan", "Search the
// shopping list", "Alexa" — from which the model produced the only summary it
// honestly could, which was that it could not summarise anything. A smart
// speaker was in the room, the microphone was hearing it, and the recogniser
// turned every sound it caught into fluent English because that is the only
// thing a speech engine can do.
//
// `recognition-quality.ts` fixed the half of that which was about MEASUREMENT:
// the engine's own confidence is now kept on each line instead of discarded, the
// language follows the browser, and a window of low scores raises a notice while
// the meeting is still running. None of that changed what the model is handed.
// Every final the engine produced still went into the prompt, each marked
// "(uncertain)", and an hour of uncertain hallucinations is still an hour of
// hallucinations: the marker tells a model to doubt a line, not to disregard a
// transcript.
//
// So this module decides what reaches the model. Two properties matter more than
// the thresholds:
//
//   - NOTHING IS DELETED. A withheld line stays in the transcript, stored and
//     shown, because the transcript is the record of what the room heard and the
//     record is not ours to edit. This only withholds it from a summariser.
//   - WHAT WAS WITHHELD IS STATED. The model is told how many lines were held
//     back and why, so its summary reports an audio problem as a fact rather
//     than inferring one from gibberish — and so a floor set in the wrong place
//     is visible in the output instead of silently eating a meeting.
//
// Pure: no DOM, no model, no storage.

/**
 * The engine confidence below which a line is not evidence of anything.
 *
 * This is a judgement, not a measurement: there is no corpus here of this
 * engine's scores against known-good and known-noise audio, so the number is
 * chosen to be safely below ordinary speech rather than tuned to a dataset.
 * Chrome's recogniser scores clean conversational speech well above this; the
 * scores that come back from a microphone hearing a room are the ones that sit
 * near the bottom.
 *
 * Being wrong is survivable in one direction only, which is why it is low. Too
 * low and some noise reaches the model, which is where it already was. Too high
 * and real speech is withheld from the summary of a real meeting — so the floor
 * stays conservative, the line is kept in the transcript either way, and the
 * count of what was withheld goes to the model with it.
 */
export const MODEL_CONFIDENCE_FLOOR = 0.35;

/**
 * Wake words a device in the room answers to.
 *
 * Deliberately excludes "echo" and "computer", which are ordinary English words
 * a meeting about infrastructure will say repeatedly.
 */
const WAKE_WORDS = [
  "alexa",
  "hey alexa",
  "hey google",
  "ok google",
  "okay google",
  "hey siri",
  "siri",
  "hey cortana",
  "cortana",
  "hey bixby",
  "bixby",
];

/**
 * The words that follow a wake word when somebody is giving an order to a
 * speaker rather than talking to a person.
 *
 * Several of these open perfectly ordinary sentences. They only ever match
 * here when a wake word came immediately before them at the start of the line,
 * which is a shape conversation does not have unless a colleague is named Alexa
 * — and the cost of being wrong about that is one line withheld from a summary,
 * not a line removed from the transcript.
 */
const COMMAND_WORDS = [
  "play", "pause", "stop", "resume", "skip", "next", "previous", "shuffle",
  "set", "cancel", "snooze", "remind", "reminder", "add", "remove", "delete",
  "search", "find", "look", "call", "text", "message", "email",
  "turn", "dim", "brighten", "volume", "mute", "unmute", "louder", "quieter",
  "open", "launch", "tell", "show", "what", "whats", "what's", "who", "whos",
  "who's", "how", "hows", "how's", "when", "where", "weather", "timer", "alarm",
  "lights", "temperature", "thermostat", "repeat", "spell", "define", "translate",
];

/** Lowercased words with surrounding punctuation stripped. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'’“”()\[\]]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether this line is a smart speaker being spoken to, not a person speaking.
 *
 * Two shapes, both narrow on purpose:
 *
 *   - the line is nothing but a wake word. A recogniser that produces one word
 *     and that word is what a device in the room is listening for has caught the
 *     device being woken, and a meeting transcript has no use for it. "Alexa."
 *     is never a contribution to a discussion.
 *   - a wake word at the START of the line, followed by an instruction. "Alexa,
 *     search the shopping list" is an order to an appliance.
 *
 * Everything else is left alone, including a line that merely mentions one of
 * these products — "Alexa is the wrong channel for this" is a sentence about a
 * business, and a rule that could not tell the difference would be worse than
 * no rule.
 */
export function isAssistantWakeLine(text: string): boolean {
  const w = words(text);
  if (w.length === 0) return false;

  for (const wake of WAKE_WORDS) {
    const parts = wake.split(" ");
    if (w.length < parts.length) continue;
    if (!parts.every((p, i) => w[i] === p)) continue;
    // Nothing but the wake word.
    if (w.length === parts.length) return true;
    // The wake word and an order.
    if (COMMAND_WORDS.includes(w[parts.length])) return true;
  }
  return false;
}

/** Why a line is kept out of the model's reading, or null when it is not. */
export type WithheldReason = "noise" | "assistant";

/**
 * How little usable speech makes a transcript not worth summarising — but ONLY
 * where recognised noise outnumbers it. A short meeting is short; it is not
 * broken, and nothing here may call it broken.
 */
export const MIN_USABLE_LINES = 6;
/** Below this share of what was heard, the audio was a problem, not a meeting. */
export const UNUSABLE_SHARE = 0.25;
/** Below this share, say so but still summarise what survived. */
export const DEGRADED_SHARE = 0.6;
/** Fewer lines than this is too small a sample to judge a share on. */
export const MIN_SHARE_SAMPLE = 10;

export type TranscriptVerdict = "silent" | "unusable" | "degraded" | "usable";

export interface TranscriptQuality {
  /** Lines in the record, withheld or not. */
  heard: number;
  /** Lines the model may read. */
  usable: number;
  withheldNoise: number;
  withheldAssistant: number;
  /** Mean engine confidence over the stored rows, where they are available. */
  meanConfidence: number | null;
  verdict: TranscriptVerdict;
}

/**
 * What this transcript is worth, in numbers rather than in a model's impression.
 *
 * The meeting this was written for ran 64 minutes and produced a report whose
 * summary was an apology. That apology was correct, and it was also a model
 * guessing from gibberish — which means it was luck. A model handed the same
 * noise on another day may instead summarise it, confidently and wrongly, into
 * decisions nobody made. The verdict is here so that reading is not left to
 * chance.
 *
 * Measured over the RECORD AS RENDERED, which is the only text that holds every
 * line: neither the copy the room posts nor the stored rows is a superset of the
 * other, and they are merged before this sees them. An earlier version of this
 * counted the stored rows instead and told the model "no speech was recognised"
 * about a meeting whose transcript was sitting in front of it, because that
 * meeting's words came from the previous report rather than from rows.
 *
 * `meanConfidence` is the one thing text cannot carry, so it is passed in from
 * the rows when there are any, and is null when there are not.
 *
 * Judged on a share rather than a count, because a 10-minute stand-up and a
 * two-hour board meeting produce very different numbers of lines from equally
 * good audio — and judged at all only when something was actually withheld. A
 * clean transcript of four sentences is a short meeting, and a rule that called
 * it unusable would tell the model to disregard a perfectly good record.
 */
export function transcriptQuality(
  record: string,
  opts: { meanConfidence?: number | null } = {},
): TranscriptQuality {
  let heard = 0;
  let usable = 0;
  let withheldNoise = 0;
  let withheldAssistant = 0;

  for (const line of (record ?? "").split("\n")) {
    if (line.trim().length === 0) continue;
    if (line.startsWith(QUALITY_NOTE_PREFIX)) continue;
    heard += 1;
    const reason = withheldLine(line);
    if (reason === "noise") withheldNoise += 1;
    else if (reason === "assistant") withheldAssistant += 1;
    else usable += 1;
  }

  const withheld = withheldNoise + withheldAssistant;
  const share = heard === 0 ? 0 : usable / heard;
  const meanConfidence = typeof opts.meanConfidence === "number" && Number.isFinite(opts.meanConfidence)
    ? opts.meanConfidence
    : null;

  let verdict: TranscriptVerdict;
  if (heard === 0) verdict = "silent";
  else if (withheld === 0) verdict = "usable";
  // The floor needs evidence that NOISE ate the meeting, not merely that
  // something was withheld. A five-sentence stand-up with one "Alexa, stop" in it
  // is a short meeting with a speaker in the room; counting that as unusable told
  // the model to disregard a perfectly good record and recommend holding the
  // meeting again — the exact thing the comment above says must not happen, and a
  // case the first version of this got wrong because every test of a short
  // transcript used a clean one.
  //
  // Assistant chatter is deliberately not evidence: a device answering its wake
  // word says nothing about whether the microphone could hear the people.
  else if (usable < MIN_USABLE_LINES && withheldNoise > usable) verdict = "unusable";
  else if (heard >= MIN_SHARE_SAMPLE && share < UNUSABLE_SHARE) verdict = "unusable";
  else if (share < DEGRADED_SHARE) verdict = "degraded";
  else verdict = "usable";

  return { heard, usable, withheldNoise, withheldAssistant, meanConfidence, verdict };
}

/** The mean of the engine scores the stored rows recorded, or null. */
export function meanRowConfidence(rows: readonly { confidence?: number | null }[]): number | null {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const c = r.confidence;
    if (typeof c === "number" && Number.isFinite(c)) { sum += c; n += 1; }
  }
  return n === 0 ? null : sum / n;
}

/** The marker that opens a note to the model, so it is never read as speech. */
export const QUALITY_NOTE_PREFIX = "[audio quality]";

/**
 * What to tell the model about the recording before it reads it.
 *
 * Plain fact and nothing else: how much was heard, how much is being withheld,
 * why, and — when the audio was bad enough — that a summary is not expected. It
 * opens with a marker no transcript line can have, because a note the model
 * mistook for something somebody said would be the worst possible outcome of
 * trying to help it.
 *
 * Null when there is nothing to say, so a clean meeting's prompt is unchanged.
 */
export function qualityPreamble(q: TranscriptQuality): string | null {
  const withheld = q.withheldNoise + q.withheldAssistant;
  if (withheld === 0 && q.verdict === "usable") return null;

  const parts: string[] = [];
  if (q.verdict === "silent") {
    parts.push("No speech was recognised during this meeting.");
  } else {
    parts.push(`${q.heard} lines of speech were recognised; ${q.usable} are included below.`);
  }
  if (q.withheldNoise > 0) {
    parts.push(
      `${q.withheldNoise} were withheld because the speech engine scored them below `
      + `${MODEL_CONFIDENCE_FLOOR}, meaning the microphone was probably hearing noise rather than words.`,
    );
  }
  if (q.withheldAssistant > 0) {
    parts.push(
      `${q.withheldAssistant} were withheld as commands to a voice assistant in the room, not meeting speech.`,
    );
  }
  if (q.meanConfidence !== null) {
    parts.push(`Mean engine confidence across everything heard was ${q.meanConfidence.toFixed(2)}.`);
  }
  if (q.verdict === "unusable" || q.verdict === "silent") {
    parts.push(
      "The audio was too poor to transcribe reliably. Do not infer decisions, action items or "
      + "attributions from what remains: report that the recording was unusable and that the "
      + "meeting should be held again with better audio.",
    );
  } else if (q.verdict === "degraded") {
    parts.push(
      "Much of the audio was unreliable. Summarise only what the remaining lines actually support, "
      + "and say that parts of the meeting could not be transcribed.",
    );
  }
  return `${QUALITY_NOTE_PREFIX} ${parts.join(" ")}`;
}

/**
 * The transcript as the model should read it, from the record as it stands.
 *
 * Two kinds of line go: one the engine scored below the floor, which carries
 * `NOISE_NOTE` from the formatter, and one that is a voice assistant being
 * spoken to, which text alone establishes.
 *
 * Only the model's copy. What is stored, shown, searched and exported is the
 * whole record, including both.
 *
 * Deliberately limited to what the rendered text can support, which is also its
 * limit: a transcript written before the engine's confidence was recorded at all
 * carries no note on any line, so it cannot be cleaned of noise and is not
 * pretended otherwise. Its wake words can still go.
 */
export function transcriptForModel(text: string): string {
  const kept = (text ?? "").split("\n").filter((line) => {
    if (line.trim().length === 0) return true;
    if (line.startsWith(QUALITY_NOTE_PREFIX)) return true;
    return withheldLine(line) === null;
  });
  return kept.join("\n");
}
