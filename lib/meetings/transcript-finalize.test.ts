/**
 * The last sentence of a call, and whether leaving loses it.
 *
 * The defect these pin: every exit tore the recognizer and microphone down in
 * the same tick and then kept only FINAL lines, so the sentence spoken just
 * before Leave or End — still interim, because the engine settles a sentence
 * up to two seconds after it ends — vanished from the save and from the posted
 * transcript alike. Under the ownership rule nobody else holds a copy.
 */
import {
  FINALIZE_WAIT_MS,
  PROMOTED_INTERIM_CONFIDENCE,
  promoteTrailingInterim,
  settleFinalWords,
  trailingInterim,
  type FinalizableLine,
} from "@/lib/meetings/transcript-finalize";
import { MODEL_CONFIDENCE_FLOOR } from "@/lib/meetings/transcript-quality";
import { LOW_CONFIDENCE } from "@/lib/meetings/speaker-attribution";

const line = (over: Partial<FinalizableLine> = {}): FinalizableLine => ({
  text: "we are agreed then",
  final: true,
  isLocal: true,
  confidence: 0.9,
  ...over,
});

describe("trailingInterim", () => {
  it("finds the local sentence still being revised", () => {
    const interim = line({ final: false, text: "so let's wire on" });
    expect(trailingInterim([line(), interim])).toBe(interim);
  });

  it("is null when everything has settled", () => {
    expect(trailingInterim([line(), line({ isLocal: false })])).toBeNull();
  });

  it("ignores an interim that holds no words", () => {
    expect(trailingInterim([line({ final: false, text: "   " })])).toBeNull();
  });
});

describe("promoteTrailingInterim", () => {
  it("keeps the engine's words as speech, marked uncertain but readable", () => {
    const out = promoteTrailingInterim([
      line({ text: "first point" }),
      line({ final: false, text: "so let's wire on Friday" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      text: "so let's wire on Friday",
      final: true,
      confidence: PROMOTED_INTERIM_CONFIDENCE,
    });
  });

  // The promoted value has to land between the two thresholds or the fix
  // defeats itself: at or above LOW_CONFIDENCE the record would present an
  // unsettled sentence as certain; below the model floor the report model
  // would never read the meeting's closing decision.
  it("claims uncertainty the thresholds respect", () => {
    expect(PROMOTED_INTERIM_CONFIDENCE).toBeLessThan(LOW_CONFIDENCE);
    expect(PROMOTED_INTERIM_CONFIDENCE).toBeGreaterThan(MODEL_CONFIDENCE_FLOOR);
  });

  it("drops an interim that is only whitespace rather than promoting it", () => {
    const out = promoteTrailingInterim([line(), line({ final: false, text: "  " })]);
    expect(out).toHaveLength(1);
    expect(out[0].final).toBe(true);
  });

  it("leaves settled lines untouched", () => {
    const settled = [line({ confidence: 0.2 }), line({ isLocal: false, confidence: 1 })];
    expect(promoteTrailingInterim(settled)).toEqual(settled);
  });
});

describe("settleFinalWords", () => {
  /** A clock and sleeper the test drives by hand. */
  function harness(initial: FinalizableLine[]) {
    let lines: readonly FinalizableLine[] = initial;
    let clock = 0;
    const stops: number[] = [];
    const sleeps: number[] = [];
    return {
      set: (next: FinalizableLine[]) => { lines = next; },
      get: () => lines,
      stops,
      sleeps,
      opts: {
        read: () => lines,
        write: (next: FinalizableLine[]) => { lines = next; },
        stopRecognition: () => { stops.push(clock); },
        sleep: async (ms: number) => { clock += ms; sleeps.push(ms); },
        now: () => clock,
      },
    };
  }

  it("resolves at once, without touching the recognizer, when nothing is mid-sentence", async () => {
    const h = harness([line()]);
    await settleFinalWords(h.opts);
    expect(h.stops).toHaveLength(0);
    expect(h.sleeps).toHaveLength(0);
  });

  it("stops the engine and returns as soon as the final replaces the interim", async () => {
    const h = harness([line({ final: false, text: "so let's wire" })]);
    // The engine's stop-flush lands during the second poll.
    let polls = 0;
    const opts = {
      ...h.opts,
      sleep: async (ms: number) => {
        await h.opts.sleep(ms);
        polls += 1;
        if (polls === 2) h.set([line({ text: "so let's wire on Friday" })]);
      },
    };
    await settleFinalWords(opts);
    expect(h.stops).toHaveLength(1);
    // Returned on the settle, not at the deadline.
    expect(polls).toBe(2);
    expect(h.get()).toEqual([line({ text: "so let's wire on Friday" })]);
  });

  it("promotes what the engine never settled, at the deadline, instead of losing it", async () => {
    const h = harness([line(), line({ final: false, text: "so let's wire on Friday" })]);
    await settleFinalWords(h.opts);
    const final = h.get();
    expect(final).toHaveLength(2);
    expect(final[1]).toMatchObject({
      text: "so let's wire on Friday",
      final: true,
      confidence: PROMOTED_INTERIM_CONFIDENCE,
    });
    // The wait was bounded: the clock never ran past the deadline by more
    // than one poll.
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(FINALIZE_WAIT_MS + 100);
  });

  it("survives a recognizer that throws on stop", async () => {
    const h = harness([line({ final: false, text: "last words" })]);
    const opts = { ...h.opts, stopRecognition: () => { throw new Error("not running"); } };
    await settleFinalWords(opts);
    expect(h.get()[0]).toMatchObject({ text: "last words", final: true });
  });
});
