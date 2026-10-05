/**
 * What the report model is allowed to read.
 *
 * Written against the Gary Jinks meeting: 64 minutes of two people whose
 * transcript is a smart speaker and a noisy room recognised as fluent English,
 * from which the model produced the only honest summary available — that it
 * could not summarise anything. These pin the two properties that matter more
 * than any threshold: that a withheld line is withheld from the MODEL and not
 * from the record, and that what was withheld is stated rather than left for a
 * model to infer from gibberish.
 */
import {
  DEGRADED_SHARE,
  MIN_USABLE_LINES,
  MODEL_CONFIDENCE_FLOOR,
  NOISE_NOTE,
  QUALITY_NOTE_PREFIX,
  isAssistantWakeLine,
  qualityPreamble,
  transcriptForModel,
  transcriptQuality,
  meanRowConfidence,
} from "./transcript-quality";

describe("isAssistantWakeLine", () => {
  it("catches a bare wake word", () => {
    // What a recogniser produces when the microphone hears the room's speaker
    // being woken. It is in this meeting's transcript on its own, repeatedly.
    expect(isAssistantWakeLine("Alexa")).toBe(true);
    expect(isAssistantWakeLine("alexa.")).toBe(true);
    expect(isAssistantWakeLine("Hey Google")).toBe(true);
    expect(isAssistantWakeLine("Siri")).toBe(true);
  });

  it("catches a wake word followed by an order", () => {
    expect(isAssistantWakeLine("Alexa, search the shopping list")).toBe(true);
    expect(isAssistantWakeLine("Alexa stop")).toBe(true);
    expect(isAssistantWakeLine("OK Google what's the weather")).toBe(true);
    expect(isAssistantWakeLine("Hey Siri, set a timer for ten minutes")).toBe(true);
  });

  it("leaves a sentence that is ABOUT one of these products alone", () => {
    // The rule that could not tell these apart would be worse than no rule: this
    // is a company that would plausibly discuss any of them as a channel.
    expect(isAssistantWakeLine("Alexa is the wrong channel for this raise")).toBe(false);
    expect(isAssistantWakeLine("Our Alexa integration slipped a quarter")).toBe(false);
    expect(isAssistantWakeLine("Google and Bixby both shipped before us")).toBe(false);
  });

  it("does not treat ordinary words as wake words", () => {
    // "echo" and "computer" are deliberately not in the list. An infrastructure
    // meeting says both constantly.
    expect(isAssistantWakeLine("Echo cancellation is on")).toBe(false);
    expect(isAssistantWakeLine("Computer, show me the cap table")).toBe(false);
    expect(isAssistantWakeLine("Search the data room for the LPA")).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isAssistantWakeLine("")).toBe(false);
    expect(isAssistantWakeLine("   ")).toBe(false);
  });
});

const clean = (n: number) => Array.from({ length: n }, (_, i) => `Gary: point ${i}`);
const noisy = (n: number) => Array.from({ length: n }, (_, i) => `Gary (${NOISE_NOTE}): garble ${i}`);
const record = (...parts: string[][]) => parts.flat().join("\n");

describe("transcriptQuality", () => {
  it("calls a clean meeting usable and says nothing about it", () => {
    const q = transcriptQuality(record(clean(40)));
    expect(q).toMatchObject({ heard: 40, usable: 40, withheldNoise: 0, verdict: "usable" });
    expect(qualityPreamble(q)).toBeNull();
  });

  it("calls this meeting's shape unusable", () => {
    // The real one: an hour of recognised noise with a handful of real sentences
    // somewhere in it. Nothing in the old pipeline distinguished this from a
    // meeting, which is how an hour of hallucination reached a summariser.
    const q = transcriptQuality(record(noisy(300), clean(8), ["Gary: Alexa"]));
    expect(q.verdict).toBe("unusable");
    expect(q.withheldNoise).toBe(300);
    expect(q.withheldAssistant).toBe(1);
    expect(q.usable).toBe(8);
  });

  it("does not call a SHORT clean transcript unusable", () => {
    // The absolute floor only bites where something was actually withheld. A
    // four-sentence meeting is a short meeting, and an earlier version of this
    // told the model to disregard one — a perfectly good record, condemned for
    // being brief.
    const q = transcriptQuality(record(clean(3)));
    expect(q.verdict).toBe("usable");
    expect(qualityPreamble(q)).toBeNull();
  });

  it("measures the record it is given, not the rows behind it", () => {
    // A regenerate works from the transcript on the previous report, and a
    // meeting can have one of those with no stored rows at all. Counting rows
    // told the model "no speech was recognised during this meeting" with that
    // meeting's transcript sitting underneath the sentence.
    const q = transcriptQuality("Ana: we agreed to wire on Friday.", { meanConfidence: null });
    expect(q).toMatchObject({ heard: 1, usable: 1, verdict: "usable" });
    expect(qualityPreamble(q)).toBeNull();
  });

  it("calls a transcript with too few surviving lines unusable", () => {
    const q = transcriptQuality(record(clean(MIN_USABLE_LINES - 1), noisy(2)));
    expect(q.verdict).toBe("unusable");
  });

  it("calls a partly-bad meeting degraded and still summarises it", () => {
    const q = transcriptQuality(record(clean(10), noisy(8)));
    expect(q.usable / q.heard).toBeLessThan(DEGRADED_SHARE);
    expect(q.verdict).toBe("degraded");
    expect(qualityPreamble(q)).toContain("Summarise only what the remaining lines actually support");
  });

  it("calls a meeting with no record at all silent", () => {
    const q = transcriptQuality("");
    expect(q).toMatchObject({ heard: 0, usable: 0, verdict: "silent", meanConfidence: null });
  });

  it("ignores its own note when counting, so a second pass cannot drift", () => {
    const first = transcriptQuality(record(clean(10), noisy(8)));
    const withNote = `${qualityPreamble(first)}\n${record(clean(10), noisy(8))}`;
    expect(transcriptQuality(withNote)).toMatchObject({ heard: first.heard, usable: first.usable });
  });
});

describe("meanRowConfidence", () => {
  it("averages every score recorded, withheld or not", () => {
    // The gauge is about the microphone, and a microphone hearing noise is a
    // microphone problem whoever the words were given to.
    expect(meanRowConfidence([{ confidence: 1 }, { confidence: 0 }])).toBeCloseTo(0.5);
  });

  it("is null when no row recorded one", () => {
    expect(meanRowConfidence([{ confidence: null }, {}])).toBeNull();
    expect(meanRowConfidence([])).toBeNull();
  });
});

describe("qualityPreamble", () => {
  it("opens with a marker no transcript line can have", () => {
    // A note the model read as something somebody said would be the worst
    // possible outcome of trying to help it.
    const note = qualityPreamble(transcriptQuality(record(clean(1), noisy(1))));
    expect(note?.startsWith(QUALITY_NOTE_PREFIX)).toBe(true);
  });

  it("tells the model not to invent a meeting out of what survived", () => {
    const note = qualityPreamble(transcriptQuality(record(noisy(300))));
    expect(note).toContain("too poor to transcribe reliably");
    expect(note).toContain("Do not infer decisions");
    expect(note).toContain("held again with better audio");
  });

  it("counts the two reasons separately, because they have different fixes", () => {
    const note = qualityPreamble(transcriptQuality(record(noisy(20), ["Gary: Alexa stop"])));
    // A noisy microphone is a room problem; a speaker answering its wake word is
    // an appliance to switch off. An operator reading one number could not tell.
    expect(note).toContain("hearing noise rather than words");
    expect(note).toContain("commands to a voice assistant");
  });

  it("reports the floor it used, so a number set wrong is visible in the output", () => {
    expect(qualityPreamble(transcriptQuality(record(noisy(3))))).toContain(String(MODEL_CONFIDENCE_FLOOR));
  });

  it("carries the mean engine confidence when the rows recorded one", () => {
    const q = transcriptQuality(record(clean(2), noisy(9)), { meanConfidence: 0.2134 });
    expect(qualityPreamble(q)).toContain("0.21");
  });

  it("says nothing at all about a meeting with nothing wrong with it", () => {
    expect(qualityPreamble(transcriptQuality(record(clean(30))))).toBeNull();
  });
});

describe("transcriptForModel", () => {
  it("drops a line the formatter marked as noise", () => {
    // The whole point. This is what 300 lines of a microphone listening to a
    // room look like on file, and every one of them used to reach the model.
    const text = [
      "Gary: so the close is the week after next",
      `Gary (${NOISE_NOTE}): Shah Rukh Khan`,
      `Astin (${NOISE_NOTE}): Rusher Rashad`,
      "Astin: that works for us",
    ].join("\n");
    expect(transcriptForModel(text)).toBe([
      "Gary: so the close is the week after next",
      "Astin: that works for us",
    ].join("\n"));
  });

  it("keeps a line that is merely uncertain", () => {
    // Doubt is not noise. A half-heard sentence is still evidence, and the model
    // is told to treat it as doubtful rather than never shown it.
    const line = "Gary (uncertain): I think the close is the week after next";
    expect(transcriptForModel(line)).toBe(line);
  });

  it("keeps a line whose WORDS happen to contain the note", () => {
    // The note is written in the speaker label, so that is the only place it is
    // read from. A sentence about transcription quality is not noise.
    const line = `Gary: the last call was ${NOISE_NOTE} and we lost the notes`;
    expect(transcriptForModel(line)).toBe(line);
  });

  it("drops an assistant order from a rendered transcript", () => {
    const text = [
      "Gary: so the close is the week after next",
      "Gary: Alexa, search the shopping list",
      "Astin: that works for us",
    ].join("\n");
    expect(transcriptForModel(text)).toBe([
      "Gary: so the close is the week after next",
      "Astin: that works for us",
    ].join("\n"));
  });

  it("reads past the uncertainty note the formatter adds", () => {
    // How a low-confidence line is actually stored, which is how every one of
    // these lines looks on file.
    expect(transcriptForModel("Gary (uncertain): Alexa")).toBe("");
  });

  it("reads past a speaker label with no note at all", () => {
    expect(transcriptForModel("Gary: Alexa, stop")).toBe("");
  });

  it("keeps a sentence that merely mentions the product", () => {
    const line = "Astin: Alexa is the wrong channel for this raise";
    expect(transcriptForModel(line)).toBe(line);
  });

  it("keeps its own note, and keeps a line with no speaker label", () => {
    const text = `${QUALITY_NOTE_PREFIX} 3 lines were withheld.\nunlabelled sentence here`;
    expect(transcriptForModel(text)).toBe(text);
  });
});
