import { UtteranceSegmenter, cleanDecode, deviceVerdict, resampleTo16k, whisperLanguage, wantsFallback, MODEL_RATE } from "./policy";

const frame = (level: number, ms: number) => new Float32Array(Math.round((MODEL_RATE * ms) / 1000)).fill(level);

describe("wantsFallback", () => {
  it("covers Firefox (no engine) and desktop Safari, not Chrome or phones", () => {
    expect(wantsFallback({ hasNativeRecognizer: false, isSafari: false, mobile: false })).toBe(true);
    expect(wantsFallback({ hasNativeRecognizer: true, isSafari: true, mobile: false })).toBe(true);
    expect(wantsFallback({ hasNativeRecognizer: true, isSafari: false, mobile: false })).toBe(false);
    expect(wantsFallback({ hasNativeRecognizer: true, isSafari: true, mobile: true })).toBe(false);
  });
});

describe("deviceVerdict", () => {
  const ok = { cores: 8, memoryGb: 8, mobile: false, hasWorker: true, hasAudioContext: true, hasWasm: true };
  it("passes a capable desktop and unknown cores", () => {
    expect(deviceVerdict(ok).ok).toBe(true);
    expect(deviceVerdict({ ...ok, cores: null, memoryGb: null }).ok).toBe(true);
  });
  it("refuses phones, weak CPUs and missing APIs", () => {
    expect(deviceVerdict({ ...ok, mobile: true }).ok).toBe(false);
    expect(deviceVerdict({ ...ok, cores: 2 }).ok).toBe(false);
    expect(deviceVerdict({ ...ok, memoryGb: 2 }).ok).toBe(false);
    expect(deviceVerdict({ ...ok, hasWasm: false }).ok).toBe(false);
  });
});

describe("cleanDecode", () => {
  it("drops stock phantoms and loops, keeps real speech", () => {
    expect(cleanDecode("Thank you.")).toBeNull();
    expect(cleanDecode("[BLANK_AUDIO]")).toBeNull();
    expect(cleanDecode("yes yes yes yes yes yes yes yes yes yes")).toBeNull();
    expect(cleanDecode("  The LPAC meets on Tuesday. ")).toBe("The LPAC meets on Tuesday.");
  });
});

describe("whisperLanguage", () => {
  it("maps tags and leaves unknown to auto-detect", () => {
    expect(whisperLanguage("fr-CA")).toBe("french");
    expect(whisperLanguage("xx")).toBeUndefined();
    expect(whisperLanguage(null)).toBeUndefined();
  });
});

describe("resampleTo16k", () => {
  it("is a no-op at 16k and shrinks 48k by a third", () => {
    const a = new Float32Array(480).fill(0.5);
    expect(resampleTo16k(a, 16000)).toBe(a);
    const out = resampleTo16k(a, 48000);
    expect(out.length).toBe(160);
    expect(out[10]).toBeCloseTo(0.5);
  });
});

describe("UtteranceSegmenter", () => {
  it("emits start, then one utterance after the silence, with preroll", () => {
    const s = new UtteranceSegmenter();
    const ev: string[] = [];
    let audio: Float32Array | undefined;
    const feed = (f: Float32Array) => s.push(f).forEach((e) => { ev.push(e.type); if (e.audio) audio = e.audio; });
    for (let i = 0; i < 5; i++) feed(frame(0.001, 100));
    for (let i = 0; i < 10; i++) feed(frame(0.1, 100));
    for (let i = 0; i < 8; i++) feed(frame(0.001, 100));
    expect(ev).toEqual(["start", "utterance"]);
    expect(audio!.length).toBeGreaterThan(MODEL_RATE); // ≥1s of speech plus preroll and tail
  });
  it("drops a click shorter than the minimum", () => {
    const s = new UtteranceSegmenter();
    const out = [...s.push(frame(0.2, 100)), ...s.push(frame(0.001, 800))];
    expect(out.map((e) => e.type)).toEqual(["start"]);
  });
  it("cuts a monologue at the maximum", () => {
    const s = new UtteranceSegmenter({ maxMs: 2000 });
    const types: string[] = [];
    for (let i = 0; i < 25; i++) s.push(frame(0.1, 100)).forEach((e) => types.push(e.type));
    expect(types.filter((t) => t === "utterance").length).toBeGreaterThanOrEqual(1);
  });
  it("flush hands back an utterance in progress", () => {
    const s = new UtteranceSegmenter();
    for (let i = 0; i < 6; i++) s.push(frame(0.1, 100));
    expect(s.flush().map((e) => e.type)).toEqual(["utterance"]);
  });
});
