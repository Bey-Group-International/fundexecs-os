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
  const ran = input.startedAt === null ? Number.POSITIVE_INFINITY : input.endedAt - input.startedAt;
  if (ran >= SHORT_RUN_MS) return { delayMs: 0, shortRuns: 0 };
  const shortRuns = input.shortRuns + 1;
  return { delayMs: Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** (shortRuns - 1)), shortRuns };
}
