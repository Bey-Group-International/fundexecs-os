/**
 * The call recorder's own arithmetic.
 *
 * Scoped the way RecordingPlayer.test.tsx is scoped: the recording lifecycle
 * (the row, the parts, the retrying upload) has its own tests behind
 * useRecording, and speech recognition is not in jsdom at all. Both are stood
 * in for here and nothing else is, so what runs is this screen's own decisions
 * — what it calls a call, and what it shows while one is being recorded.
 *
 * What these do NOT guard: that a settled transcript line stops re-rendering
 * when the next sentence arrives. That is a render count, and React gives a
 * test no faithful way to observe one from outside the module — a keyed row
 * with unchanged props writes nothing to the DOM either way, so every
 * assertion available here would pass on the unfixed code. It was measured
 * with a Profiler instead (2,066 row bodies per sentence at 2,000 lines, down
 * to 1) and the number is in the pull request, not in CI.
 */
import { render, act, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import type { UseRecordingResult } from "@/lib/meetings/use-recording";
import { FLUSH_INTERVAL_MS } from "@/lib/meetings/transcript-buffer";
import { defaultCallTitle } from "@/lib/meetings/one-way";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

/** The recording, as far as this screen can see it. */
let recorder: UseRecordingResult;
jest.mock("@/lib/meetings/use-recording", () => ({
  useRecording: () => recorder,
}));

import { CallRecorder } from "./CallRecorder";

/**
 * The title the route settles on, which is the one stored on the row.
 *
 * A literal, because the only thing asserted about it is that it survives the
 * round trip from the route's answer to the report's request untouched. Nothing
 * here formats it, so no clock or time zone can move it.
 */
const ROUTE_TITLE = "Call \u00b7 Sep 23, 2:05 PM";
const STARTED_AT = "2026-09-23T14:05:30.000Z";

/**
 * What a title GENERATED at the start of the call reads as.
 *
 * Derived rather than written out, because `defaultCallTitle` formats in the
 * host's own time zone: spelled as a literal this was "2:05 PM" under CI's UTC
 * and "7:05 AM" for anybody running the suite in California, so two tests
 * passed in CI and failed on a contributor's machine.
 *
 * Not circular. What these tests discriminate is WHICH INSTANT the title is
 * taken from — the start of the call rather than its end, and the mount rather
 * than every render — so the formatting is shared with the code under test on
 * purpose and the instant is the whole assertion.
 */
const GENERATED_AT_START = () => defaultCallTitle(new Date(STARTED_AT));

/** Every request the screen made, in order. */
let calls: Array<{ url: string; body: Record<string, unknown> }>;

function setup(opts: { routeTitle?: string | undefined } = {}) {
  calls = [];
  push.mockClear();
  recorder = {
    state: "recording",
    error: null,
    notice: null,
    dismissNotice: () => {},
    elapsed: 0,
    startedAt: Date.now(),
    start: jest.fn(async () => {}),
    stop: jest.fn(),
  };

  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }),
  };

  global.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/one-way")) {
      return {
        ok: true,
        json: async () => ({ id: "m1", roomCode: "abc-def", title: opts.routeTitle }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;

  return render(<CallRecorder userId="u1" userName="Ada Bey" orgName="Bey Group" />);
}

/**
 * A recogniser this test can speak into.
 *
 * jsdom has no SpeechRecognition at all, so without one the screen takes its
 * "this browser cannot transcribe" path and there is no transcript to check.
 * Only the slice the component uses is stood up.
 */
function installSpeechRecognition() {
  let onresult: ((ev: unknown) => void) | null = null;
  const settled: Array<{ text: string; confidence: number }> = [];
  const instances: Array<{ lang: string }> = [];

  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onend: (() => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    constructor() { instances.push(this); }
    set onresult(fn: (ev: unknown) => void) { onresult = fn; }
    get onresult() { return onresult as (ev: unknown) => void; }
    start() {}
    stop() { this.onend?.(); }
  }
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;

  /** Emit a results list the way the browser does: everything so far, growing. */
  const emit = (interim: string | null) => {
    const results: Array<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> =
      settled.map((s) => ({ isFinal: true, 0: { transcript: s.text, confidence: s.confidence } }));
    if (interim !== null) results.push({ isFinal: false, 0: { transcript: interim, confidence: 0 } });
    onresult?.({ resultIndex: results.length - 1, results });
  };

  return {
    /** A sentence the recogniser has settled on, with the engine's score for it. */
    say(text: string, confidence = 0.9) { settled.push({ text, confidence }); emit(null); },
    /** Words still being revised. */
    hear(text: string) { emit(text); },
    /** Every recogniser the screen constructed, for asserting what it was told. */
    instances,
  };
}

/** Every row the transcript is showing, in order. */
function rows(): string[] {
  return [...document.querySelectorAll("ol li")].map((li) => li.textContent ?? "");
}

/** Tick the consent box and press the button, as a person would. */
async function startRecording() {
  fireEvent.click(screen.getByRole("checkbox", { name: /consent/i }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /start recording/i }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Press End and let the recogniser hand over its last words. */
async function endRecording() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /end and summarise/i }));
    jest.advanceTimersByTime(3_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date(STARTED_AT));
});
afterEach(() => {
  jest.useRealTimers();
});

// ── What the call is called ─────────────────────────────────────────────────
//
// The route resolves the title, stores it on the row and returns it. The screen
// used to throw that away and work a default out again when the call ended, so
// an untitled hour-long call was in the archive under the minute it started and
// in the report under the minute it finished.

describe("one call, one name", () => {
  it("reports the call under the name the route stored, an hour later", async () => {
    setup({ routeTitle: ROUTE_TITLE });
    await startRecording();

    // The call runs for over an hour, crossing both a minute and an hour.
    jest.setSystemTime(new Date("2026-09-23T15:12:40.000Z"));
    await endRecording();

    const report = calls.find((c) => c.url.endsWith("/report"));
    expect(report).toBeDefined();
    expect(report!.body.title).toBe(ROUTE_TITLE);
  });

  it("keeps the name the person typed", async () => {
    setup({ routeTitle: "Dunbar follow-up" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Dunbar follow-up" } });
    await startRecording();
    jest.setSystemTime(new Date("2026-09-23T15:12:40.000Z"));
    await endRecording();

    expect(calls.find((c) => c.url.endsWith("/one-way"))!.body.title).toBe("Dunbar follow-up");
    expect(calls.find((c) => c.url.endsWith("/report"))!.body.title).toBe("Dunbar follow-up");
  });

  // A route that answered without one — an older deployment — must not leave
  // the report untitled. The fallback is the same rule the route applies, read
  // at the same moment: the start of the call.
  it("falls back to the call's own start time, not the time it ended", async () => {
    setup({ routeTitle: undefined });
    await startRecording();
    jest.setSystemTime(new Date("2026-09-23T15:12:40.000Z"));
    await endRecording();

    const title = calls.find((c) => c.url.endsWith("/report"))!.body.title as string;
    expect(title).toBe(GENERATED_AT_START());
  });
});

// ── The name it suggests ────────────────────────────────────────────────────

describe("the suggested title", () => {
  it("does not move while the person is typing beside it", () => {
    setup({ routeTitle: ROUTE_TITLE });
    const field = screen.getByRole("textbox");
    expect(field.getAttribute("placeholder")).toBe(GENERATED_AT_START());

    // A minute passes — someone reading the consent wording takes longer than
    // that — and something else on the screen changes.
    jest.setSystemTime(new Date("2026-09-23T14:06:10.000Z"));
    fireEvent.click(screen.getByRole("checkbox", { name: /consent/i }));

    expect(field.getAttribute("placeholder")).toBe(GENERATED_AT_START());
  });
});

// ── The transcript ──────────────────────────────────────────────────────────

describe("the transcript", () => {
  it("shows nothing until there are words", async () => {
    setup({ routeTitle: ROUTE_TITLE });
    await startRecording();
    expect(screen.getByText(/Words appear here/)).toBeTruthy();
    expect(document.querySelector("ol")).toBeNull();
  });

  // One row per settled line and exactly one for the words still being
  // recognised. The finished lines are drawn through a memoised row, and the
  // failure mode of getting that wrong is rows that go missing or double up —
  // which is what this counts.
  it("draws one row per settled line, plus the words still arriving", async () => {
    setup({ routeTitle: ROUTE_TITLE });
    const speech = installSpeechRecognition();
    await startRecording();

    await act(async () => { speech.say("The valuation came in at forty."); });
    expect(rows()).toEqual(["The valuation came in at forty."]);

    await act(async () => { speech.say("We agreed to revisit it in March."); });
    expect(rows()).toEqual([
      "The valuation came in at forty.",
      "We agreed to revisit it in March.",
    ]);

    // Interim words are a caption of a sentence still being revised: one row,
    // replaced, never accumulated.
    await act(async () => { speech.hear("and the next"); });
    expect(rows()).toEqual([
      "The valuation came in at forty.",
      "We agreed to revisit it in March.",
      "and the next",
    ]);
    await act(async () => { speech.hear("and the next point"); });
    expect(rows()).toEqual([
      "The valuation came in at forty.",
      "We agreed to revisit it in March.",
      "and the next point",
    ]);

    // Settling it replaces the caption rather than adding to it.
    await act(async () => { speech.say("And the next point was carried."); });
    expect(rows()).toEqual([
      "The valuation came in at forty.",
      "We agreed to revisit it in March.",
      "And the next point was carried.",
    ]);
  });

  it("saves the settled lines and never the interim ones", async () => {
    setup({ routeTitle: ROUTE_TITLE });
    const speech = installSpeechRecognition();
    await startRecording();
    await act(async () => { speech.say("First sentence."); });
    await act(async () => { speech.hear("half a second"); });

    await act(async () => {
      jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    const flush = calls.filter((c) => c.url.endsWith("/transcript"));
    expect(flush).toHaveLength(1);
    const lines = flush[0].body.lines as Array<{ text: string }>;
    expect(lines.map((l) => l.text)).toEqual(["First sentence."]);
  });

  // The engine's score is read the way the room reads it (recognition-quality):
  // 0 and absent both mean "not scored", not "certainly noise". Stored raw, an
  // unscoring engine's 0 sat below MODEL_CONFIDENCE_FLOOR on every row, so the
  // archive rendered the whole call as "uncertain — not recognised reliably"
  // and the regenerated report was told to read none of it.
  it("stores an unscored final as unknown confidence, and a scored one as its score", async () => {
    setup({ routeTitle: ROUTE_TITLE });
    const speech = installSpeechRecognition();
    await startRecording();
    await act(async () => { speech.say("The valuation came in at forty.", 0); });
    await act(async () => { speech.say("We agreed to revisit it in March.", 0.72); });

    await act(async () => {
      jest.advanceTimersByTime(FLUSH_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    const flush = calls.filter((c) => c.url.endsWith("/transcript"));
    expect(flush).toHaveLength(1);
    const lines = flush[0].body.lines as Array<{ text: string; confidence: number }>;
    expect(lines.map((l) => l.confidence)).toEqual([1, 0.72]);
  });

  // The language the engine is told decides whether it hears speech or produces
  // fluent nonsense in the wrong tongue. en-US was hard-coded here after the
  // meeting room had already moved to the browser's own language.
  it("tells the recogniser the browser's language, not en-US for everyone", async () => {
    const realLanguage = Object.getOwnPropertyDescriptor(Navigator.prototype, "language");
    Object.defineProperty(navigator, "language", { value: "es-ES", configurable: true });
    try {
      setup({ routeTitle: ROUTE_TITLE });
      const speech = installSpeechRecognition();
      await startRecording();
      expect(speech.instances.length).toBeGreaterThan(0);
      expect(speech.instances[0].lang).toBe("es-ES");
    } finally {
      // jsdom defines language on the prototype; the instance override is ours.
      delete (navigator as unknown as Record<string, unknown>).language;
      if (realLanguage) Object.defineProperty(Navigator.prototype, "language", realLanguage);
    }
  });
});
