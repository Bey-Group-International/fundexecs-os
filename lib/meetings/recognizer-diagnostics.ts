// lib/meetings/recognizer-diagnostics.ts
// What the speech recogniser was given, and what it gave back — stored beside
// every line it produced, so a bad transcript can be read against the facts
// that made it instead of guessed at from the words.
//
// Read against the host's meetings of 2 to 9 October 2026. Every row of theirs
// after 2 October 16:26 UTC is three or four punctuated words of nonsense
// ("Bob Popcorn.", "Washoe surgery Power.") stored at confidence 1.0, while
// every guest on Chrome kept twenty-five word sentences with real engine
// scores. The change at that minute handed the recogniser the call's own
// microphone track (`start(track)`). The transcript turned the moment that
// path was first taken — mid-call on 2 October, where the first run had still
// started bare — and nothing stored says which path a line came from, which
// engine produced it, or whether the engine scored it at all. This records
// exactly that, per line, in a form SQL can group by.
//
// Pure: no DOM. The room passes in what it read from the browser.

/** How a recognition run was started. */
export type RecognizerPath = "track" | "bare";

/**
 * The facts a stored line carries about the run that produced it.
 *
 * Kept flat and short: it is written on every utterance of every meeting and
 * read back by a query, not a person. `brand` is the browser's own name for
 * itself (User-Agent Client Hints where present, else a guess from the UA
 * string), because the engine behind `SpeechRecognition` is the browser's, not
 * Chromium's — Edge swaps in its own — and nothing else stored tells them apart.
 */
export interface RecognizerDiagnostics {
  /** Browser brand, e.g. "Microsoft Edge", "Google Chrome", "Safari". */
  brand: string;
  /** Whether the engine exposes the static `available()` beside track support. */
  available: boolean;
  /** How the run that produced this line was started. */
  path: RecognizerPath;
  /** Ordinal of that run within the call, from 1. */
  run: number;
  /** How long the run had been going when the line settled, in ms; null if unknown. */
  runAgeMs: number | null;
  /** The engine's own score for the line, exactly as given; null when it gave none. */
  engineConfidence: number | null;
  /** The label of the microphone track the run was started on, if any. */
  trackLabel: string | null;
  /** The language the engine was told. */
  lang: string;
}

interface BrandEntry { brand: string }

/**
 * The browser's brand, from the facts a page can read.
 *
 * Client Hints first: `navigator.userAgentData.brands` lists the real brand
 * beside Chromium and a GREASE entry ("Not_A Brand", "Not;A=Brand" ...), so the
 * first entry that is neither is the answer. Without hints (Safari, Firefox,
 * older engines) the UA string decides: `Edg/` before `Chrome/` because Edge
 * carries both, and `Safari/` last because every WebKit-derived UA carries it.
 */
export function browserBrand(
  brands: readonly BrandEntry[] | null | undefined,
  userAgent: string | null | undefined,
): string {
  if (Array.isArray(brands)) {
    for (const entry of brands) {
      const b = (entry?.brand ?? "").trim();
      if (!b) continue;
      if (/not.?a.?brand/i.test(b)) continue;
      if (/^chromium$/i.test(b)) continue;
      return b;
    }
    const chromium = brands.find((e) => /^chromium$/i.test((e?.brand ?? "").trim()));
    if (chromium) return "Chromium";
  }
  const ua = userAgent ?? "";
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return "Microsoft Edge";
  if (/\bOPR\//.test(ua)) return "Opera";
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/\bFirefox\//.test(ua)) return "Firefox";
  if (/\bCriOS\//.test(ua)) return "Google Chrome";
  if (/\bChrome\//.test(ua)) return "Google Chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari";
  return ua ? "unknown" : "";
}

/** The run facts the room keeps while a run is going. */
export interface RecognizerRun {
  path: RecognizerPath;
  run: number;
  startedAt: number | null;
  trackLabel: string | null;
}

/**
 * The diagnostics for one settled line.
 *
 * `engineConfidence` is stored RAW — zero included — because the storage rule
 * elsewhere turns a zero into "no score", and whether the engine said zero or
 * said nothing is one of the questions this exists to answer.
 */
export function lineDiagnostics(input: {
  brand: string;
  available: boolean;
  run: RecognizerRun;
  engineConfidence: unknown;
  lang: string;
  now: number;
}): RecognizerDiagnostics {
  const c = input.engineConfidence;
  const engine = typeof c === "number" && Number.isFinite(c) ? c : null;
  return {
    brand: input.brand,
    available: input.available,
    path: input.run.path,
    run: input.run.run,
    runAgeMs: input.run.startedAt === null ? null : Math.max(0, input.now - input.run.startedAt),
    engineConfidence: engine,
    trackLabel: input.run.trackLabel,
    lang: input.lang,
  };
}

/** The most bytes a stored diagnostics object may take, serialised. */
export const MAX_DIAGNOSTICS_BYTES = 1_000;

/**
 * What the save route keeps of a client's diagnostics: the known keys, each
 * at its expected type, and nothing else. A client is not trusted to write
 * arbitrary JSON into the table.
 */
export function sanitizeDiagnostics(raw: unknown): RecognizerDiagnostics | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" ? v.slice(0, max) : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const path = r.path === "track" || r.path === "bare" ? r.path : null;
  if (!path) return null;
  const out: RecognizerDiagnostics = {
    brand: str(r.brand, 60) ?? "",
    available: r.available === true,
    path,
    run: Math.max(0, Math.floor(num(r.run) ?? 0)),
    runAgeMs: num(r.runAgeMs),
    engineConfidence: num(r.engineConfidence),
    trackLabel: str(r.trackLabel, 120),
    lang: str(r.lang, 35) ?? "",
  };
  if (JSON.stringify(out).length > MAX_DIAGNOSTICS_BYTES) return null;
  return out;
}
