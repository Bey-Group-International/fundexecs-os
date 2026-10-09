// lib/meetings/recognition-quality.ts
// What the speech recogniser is told, and what it tells us back.
//
// Read against the Gary Jinks meeting (86846a43), where two people talked for
// an hour and the transcript is noise recognised as words -- "Shah Rukh Khan",
// "Search the shopping list", "Rusher Rashad" -- every line stored at
// confidence 1.0. Three things in the room's recognition wiring made that
// worse than it had to be, and this module holds the decisions behind the
// fixes so they can be tested without a browser:
//
//  - The engine's own confidence was discarded. `onresult` read only the
//    transcript of each alternative; the `confidence` stored on the line was
//    the attribution's (WHO said it), never the recogniser's (WHAT was said).
//    So the report model was handed hallucinated words as certain fact, and
//    the "(uncertain)" marker that exists for exactly this never fired.
//  - The language was hard-coded to en-US, whatever the member's browser ran.
//  - A recogniser that ended was restarted at once, forever: a dead or missing
//    microphone turned into a tight loop of start/end.
//
// Pure: no SpeechRecognition, no DOM, no timers.

/** What the room falls back to when the browser's language is unusable. */
export const DEFAULT_RECOGNITION_LANG = "en-US";

/**
 * The language to recognise.
 *
 * The browser's own language, when it is a plausible BCP 47 tag. A member whose
 * browser runs in Spanish is far more likely to be speaking Spanish than
 * American English, and an engine told the wrong language does not fail -- it
 * produces fluent nonsense in the language it was told, which is what an hour
 * of this meeting's transcript looks like.
 */
export function recognitionLang(navigatorLanguage: string | null | undefined): string {
  const tag = (navigatorLanguage ?? "").trim();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(tag) ? tag : DEFAULT_RECOGNITION_LANG;
}

/**
 * The engine's confidence in an alternative, or null when it gave none.
 *
 * Engines that do not score an alternative report 0 or leave the field out;
 * neither is "no confidence at all", so both read as unknown rather than as
 * certainty or as doubt.
 */
export function engineConfidence(alternative: { confidence?: unknown } | null | undefined): number | null {
  const c = alternative?.confidence;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  return Math.min(1, c);
}

/**
 * The confidence stored on a transcript line.
 *
 * Two doubts, one number: how sure we are WHO said it (attribution) and how
 * sure the engine is WHAT was said. The line is only as good as the weaker of
 * the two, so that is what is kept -- and what `formatTranscriptLine` reads to
 * decide whether the report model sees "(uncertain)".
 */
export function lineConfidence(attribution: number, engine: number | null): number {
  const a = Math.min(1, Math.max(0, attribution));
  return engine === null ? a : Math.min(a, engine);
}

/**
 * What a line is worth when NOTHING vouches for it. Deliberately below
 * `MODEL_CONFIDENCE_FLOOR` (0.35): the line stays in the record, marked as
 * unreliable, and is withheld from the report model.
 */
export const UNVOUCHED_CONFIDENCE = 0.3;

/**
 * `lineConfidence`, with the hallucination case closed.
 *
 * A speech engine fed silence does not stay silent: it flushes short fluent
 * phrases — a "thank you", a greeting — invented from room tone. Such a final
 * arrives with two tells at once: the voice meter measured the window and
 * found NOBODY audible (attribution "unattributed"), and the engine declined
 * to score its own output. Separately each is forgivable — quiet real speech
 * can sit under the meter's threshold but earns a high engine score; a
 * scoreless engine on real speech has a voice in the meter behind it. Both
 * tells together is a line no evidence supports, and it used to land at
 * exactly the model floor, where the strict `<` comparison let every such
 * phrase into the report as something the host said.
 *
 * The guard needs `measured`: on a device whose meter never ran, EVERY line
 * is "unattributed", and an engine that never scores (older Safari) would
 * have the whole meeting withheld. Absence of evidence convicts nobody.
 */
export function guardedLineConfidence(
  attribution: { confidence: number; basis: string; measured: boolean },
  engine: number | null,
): number {
  const c = lineConfidence(attribution.confidence, engine);
  if (attribution.basis === "unattributed" && attribution.measured && engine === null) {
    return Math.min(c, UNVOUCHED_CONFIDENCE);
  }
  return c;
}

/** How many recent engine scores the noise gauge looks at. */
export const NOISE_WINDOW = 8;
/** Fewer than this many scores is too little to call the audio noisy. */
export const NOISE_MIN_SAMPLES = 5;
/** A window averaging below this is a microphone hearing mostly noise. */
export const NOISE_THRESHOLD = 0.5;

/** The last few engine scores, newest last, capped at NOISE_WINDOW. */
export function pushEngineScore(window: readonly number[], score: number): number[] {
  const next = [...window, score];
  return next.length > NOISE_WINDOW ? next.slice(next.length - NOISE_WINDOW) : next;
}

/**
 * Whether the recogniser has been hearing mostly noise.
 *
 * Judged on a window, not a line: one mumbled word is nothing, but five finals
 * in a row that the engine itself scores below even odds is a microphone
 * problem -- a phone on a desk, a headset on the wrong input, a loudspeaker
 * feeding back -- and it is worth telling the member while the meeting is
 * still going rather than in a report that reads as gibberish afterwards.
 */
export function isNoisy(window: readonly number[]): boolean {
  if (window.length < NOISE_MIN_SAMPLES) return false;
  const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
  return mean < NOISE_THRESHOLD;
}

/** Accumulated speech, with nothing back from the engine, before the alarm. */
export const DEAF_SPEECH_MS = 12_000;

/**
 * The deaf-recogniser watch: is transcription hearing a different microphone?
 *
 * The Web Speech API has no way to be pointed at a device on most engines. The
 * room passes the call's own track to `start(track)`, but an engine that does
 * not take the argument ignores it without a word and captures the COMPUTER'S
 * DEFAULT microphone instead. A host on an external mic or conference device —
 * exactly the host who cares about the transcript — then has the whole call
 * transcribed from a laptop mic across the room (wrong words) or from a silent
 * endpoint (no words at all), and nothing anywhere said why: the room, the
 * meter and the other participants all hear the real microphone.
 *
 * The one signal the client does have is the disagreement itself: the voice
 * meter runs on the call's track, so when it has seen the member audibly
 * speaking for many seconds while an active recogniser has produced nothing —
 * not a final, not an interim, not a speechstart — the engine is not hearing
 * that microphone. Twelve seconds of actual speech is decisive: an engine on
 * the right device answers with an interim within a second or two.
 *
 * Mutating, like the echo and voice-return watches: one object per call,
 * touched on every meter tick.
 */
export interface DeafWatch {
  /** Milliseconds of the member audibly speaking since the engine last answered. */
  spokenMs: number;
  /** The alarm is up. It re-raises only after the engine is heard from again. */
  raised: boolean;
}

export function createDeafWatch(): DeafWatch {
  return { spokenMs: 0, raised: false };
}

/**
 * One meter tick. Returns true exactly once, on the tick that raises the alarm.
 *
 * `speaking` must already account for mute: a muted member's silence is not
 * evidence about the engine, and nor is an ordinary pause — only time spent
 * audibly talking counts toward the threshold.
 */
export function observeDeafTick(
  watch: DeafWatch,
  tick: { active: boolean; speaking: boolean; tickMs: number },
): boolean {
  if (!tick.active) {
    // Not listening (unsupported, errored, torn down): nothing to accuse.
    watch.spokenMs = 0;
    return false;
  }
  if (!tick.speaking) return false;
  watch.spokenMs += tick.tickMs;
  if (!watch.raised && watch.spokenMs >= DEAF_SPEECH_MS) {
    watch.raised = true;
    return true;
  }
  return false;
}

/**
 * The engine produced something — a result event or a speechstart. Returns
 * true when this clears a raised alarm, so the notice can withdraw itself.
 */
export function recognizerHeard(watch: DeafWatch): boolean {
  watch.spokenMs = 0;
  if (!watch.raised) return false;
  watch.raised = false;
  return true;
}

/** A run shorter than this ended before it could have heard anything. */
export const SHORT_RUN_MS = 1_000;
/** The first pause after a short run; doubles each time, up to the cap. */
export const RESTART_BASE_MS = 500;
export const RESTART_MAX_MS = 8_000;

/**
 * How long to wait before starting the recogniser again, and the short-run
 * count to carry forward.
 *
 * A run that lasted is restarted at once -- continuous recognition ends on
 * its own every minute or so, and the gap should be invisible. A run that
 * ended almost as soon as it started is the engine refusing the audio (no
 * microphone, a dead track, a capture error), and restarting it at once is a
 * loop that burns a core and logs an error a hundred times a second. Each
 * consecutive short run doubles the pause, up to a few seconds.
 */
export function restartDelay(input: {
  startedAt: number | null;
  endedAt: number;
  shortRuns: number;
}): { delayMs: number; shortRuns: number } {
  // A run that never reported starting is the shortest run there is: the
  // engine went start → error → end without ever listening. This used to read
  // as a run that lasted, which restarted it at once, forever — the exact
  // tight loop the backoff exists to stop, on exactly the engines (no network,
  // no service) that produce it.
  const ran = input.startedAt === null ? 0 : input.endedAt - input.startedAt;
  if (ran >= SHORT_RUN_MS) return { delayMs: 0, shortRuns: 0 };
  const shortRuns = input.shortRuns + 1;
  return { delayMs: Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** (shortRuns - 1)), shortRuns };
}

/**
 * How many runs in a row may die at once before the engine is called failing.
 *
 * The first short run is a blip; the third is a pattern, and by then the
 * backoff has the loop down to one attempt every couple of seconds. The room
 * keeps trying past this — the engine may come back when the network does —
 * but it stops claiming to be transcribing while it does.
 */
export const FAILING_SHORT_RUNS = 3;

/**
 * Errors after which the engine is not going to hear the next run either.
 *
 * `network` is the big one: Brave, Chromium builds without API keys, a proxy
 * that blocks the speech endpoint, or simply being offline — every run goes
 * start → network → end, and before this the room reported "active" for the
 * whole call. `audio-capture` is a microphone the engine could not open.
 * `not-allowed` and `service-not-allowed` are terminal and handled on the
 * error itself; `no-speech` and `aborted` are ordinary.
 */
export const FAILING_ERRORS: ReadonlySet<string> = new Set(["network", "audio-capture"]);

/**
 * What the recogniser's status should read after a run ended.
 *
 * "failing" is the honest state for an engine that keeps dying: it is still
 * being restarted, so it is not "error", but it is not transcribing anybody
 * either, and the room — the host reading the report in particular — needs to
 * know that. `lastError` is the error reported during the run that just
 * ended, or null. A run that lasted clears everything: the engine is working.
 */
export function recognizerStatusAfterEnd(input: {
  shortRuns: number;
  lastError: string | null;
}): "active" | "failing" {
  if (input.lastError !== null && FAILING_ERRORS.has(input.lastError)) return "failing";
  if (input.shortRuns >= FAILING_SHORT_RUNS) return "failing";
  return "active";
}

/**
 * What to tell the member whose engine is failing. Names the cause they can
 * act on; a generic "transcription failed" sends them to the wrong settings.
 */
export function recognizerFailureNotice(lastError: string | null): string {
  switch (lastError) {
    case "network":
      return "Transcription can't reach its speech service, so your words aren't being transcribed. "
        + "This browser may block it (Brave, or a network that blocks Google's speech endpoint); "
        + "Chrome or Edge with an open connection fixes it. The call itself is fine.";
    case "audio-capture":
      return "Transcription can't open your microphone, so your words aren't being transcribed. "
        + "Pick another microphone from the arrow beside the mic button. The call itself is fine.";
    default:
      return "Transcription keeps stopping, so your words aren't being transcribed. "
        + "The room keeps retrying; if this stays up, your side of the meeting won't reach the report.";
  }
}
