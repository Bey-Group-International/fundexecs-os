import {
  DEAF_SPEECH_MS,
  DEFAULT_RECOGNITION_LANG,
  NOISE_MIN_SAMPLES,
  NOISE_WINDOW,
  RESTART_MAX_MS,
  createDeafWatch,
  engineConfidence,
  isNoisy,
  lineConfidence,
  observeDeafTick,
  pushEngineScore,
  recognitionLang,
  recognizerHeard,
  restartDelay,
  type DeafWatch,
} from "./recognition-quality";

describe("recognitionLang", () => {
  it("follows the browser's language", () => {
    expect(recognitionLang("es-MX")).toBe("es-MX");
    expect(recognitionLang("fr")).toBe("fr");
    expect(recognitionLang("zh-Hans-CN")).toBe("zh-Hans-CN");
  });

  it("falls back to en-US when the browser gives nothing usable", () => {
    expect(recognitionLang(undefined)).toBe(DEFAULT_RECOGNITION_LANG);
    expect(recognitionLang("")).toBe(DEFAULT_RECOGNITION_LANG);
    expect(recognitionLang("not a language")).toBe(DEFAULT_RECOGNITION_LANG);
  });
});

describe("engineConfidence", () => {
  it("reads a real score", () => {
    expect(engineConfidence({ confidence: 0.87 })).toBe(0.87);
    expect(engineConfidence({ confidence: 1.4 })).toBe(1);
  });

  // 0 and "missing" are both engines that did not score, not engines that
  // scored zero.
  it("is unknown when the engine gave none", () => {
    expect(engineConfidence({ confidence: 0 })).toBeNull();
    expect(engineConfidence({})).toBeNull();
    expect(engineConfidence(undefined)).toBeNull();
    expect(engineConfidence({ confidence: Number.NaN })).toBeNull();
  });
});

describe("lineConfidence", () => {
  // The line this whole module exists for: attributed with certainty to the
  // person whose microphone it came from, and recognised at 0.2.
  it("is the weaker of who-said-it and what-was-said", () => {
    expect(lineConfidence(1, 0.2)).toBe(0.2);
    expect(lineConfidence(0.5, 0.9)).toBe(0.5);
  });

  it("is the attribution alone when the engine did not score", () => {
    expect(lineConfidence(0.8, null)).toBe(0.8);
  });

  it("stays inside 0..1", () => {
    expect(lineConfidence(1.7, null)).toBe(1);
    expect(lineConfidence(-1, null)).toBe(0);
  });
});

describe("the noise gauge", () => {
  it("keeps only the last few scores", () => {
    let w: number[] = [];
    for (let i = 0; i < NOISE_WINDOW + 3; i++) w = pushEngineScore(w, i);
    expect(w).toHaveLength(NOISE_WINDOW);
    expect(w[0]).toBe(3);
  });

  it("will not call the audio noisy on too few lines", () => {
    expect(isNoisy(Array(NOISE_MIN_SAMPLES - 1).fill(0.1))).toBe(false);
  });

  it("calls it noisy when the engine scores a run of finals below even odds", () => {
    expect(isNoisy([0.3, 0.2, 0.45, 0.1, 0.4])).toBe(true);
  });

  it("does not on ordinary speech with one mumbled word", () => {
    expect(isNoisy([0.9, 0.85, 0.2, 0.92, 0.88])).toBe(false);
  });
});

describe("restartDelay", () => {
  it("restarts at once after a run that lasted", () => {
    expect(restartDelay({ startedAt: 0, endedAt: 65_000, shortRuns: 3 })).toEqual({ delayMs: 0, shortRuns: 0 });
  });

  it("backs off, doubling, after runs that died at once", () => {
    const first = restartDelay({ startedAt: 1000, endedAt: 1100, shortRuns: 0 });
    expect(first).toEqual({ delayMs: 500, shortRuns: 1 });
    const second = restartDelay({ startedAt: 2000, endedAt: 2050, shortRuns: first.shortRuns });
    expect(second).toEqual({ delayMs: 1000, shortRuns: 2 });
  });

  it("caps the pause", () => {
    expect(restartDelay({ startedAt: 0, endedAt: 1, shortRuns: 20 }).delayMs).toBe(RESTART_MAX_MS);
  });

  it("treats a run that never started as one that lasted", () => {
    expect(restartDelay({ startedAt: null, endedAt: 5, shortRuns: 2 })).toEqual({ delayMs: 0, shortRuns: 0 });
  });
});

describe("the deaf-recogniser watch", () => {
  const tick = (over: Partial<{ active: boolean; speaking: boolean; tickMs: number }> = {}) =>
    ({ active: true, speaking: true, tickMs: 120, ...over });

  /** Accumulate `ms` of audible speech against an active, silent engine. */
  function speakFor(watch: DeafWatch, ms: number): boolean {
    let raised = false;
    for (let spent = 0; spent < ms; spent += 120) {
      if (observeDeafTick(watch, tick())) raised = true;
    }
    return raised;
  }

  it("raises once after enough audible speech the engine never answered", () => {
    const watch = createDeafWatch();
    expect(speakFor(watch, DEAF_SPEECH_MS - 240)).toBe(false);
    expect(speakFor(watch, 480)).toBe(true);
    // Once. The notice must not re-post itself on every later tick.
    expect(speakFor(watch, 5_000)).toBe(false);
  });

  it("counts only audible speech — pauses and mute are not evidence", () => {
    const watch = createDeafWatch();
    for (let i = 0; i < 1_000; i++) observeDeafTick(watch, tick({ speaking: false }));
    expect(watch.spokenMs).toBe(0);
    // Interleaved speech still accumulates across the pauses.
    expect(speakFor(watch, DEAF_SPEECH_MS)).toBe(true);
  });

  it("accuses nothing while the recogniser is not active", () => {
    const watch = createDeafWatch();
    for (let i = 0; i < 200; i++) expect(observeDeafTick(watch, tick({ active: false }))).toBe(false);
    // And an inactive stretch resets what speech had accumulated.
    speakFor(watch, DEAF_SPEECH_MS - 120);
    observeDeafTick(watch, tick({ active: false }));
    expect(speakFor(watch, 240)).toBe(false);
  });

  it("stands down when the engine is heard from, and can raise again", () => {
    const watch = createDeafWatch();
    speakFor(watch, DEAF_SPEECH_MS);
    expect(watch.raised).toBe(true);
    expect(recognizerHeard(watch)).toBe(true);
    expect(watch.raised).toBe(false);
    // Hearing from it while nothing is raised clears nothing.
    expect(recognizerHeard(watch)).toBe(false);
    // A later silent stretch is a fresh episode.
    expect(speakFor(watch, DEAF_SPEECH_MS)).toBe(true);
  });

  it("never raises while the engine keeps answering", () => {
    const watch = createDeafWatch();
    for (let i = 0; i < 500; i++) {
      expect(observeDeafTick(watch, tick())).toBe(false);
      // An interim arrives at least every few seconds while someone talks.
      if (i % 20 === 19) recognizerHeard(watch);
    }
    expect(watch.raised).toBe(false);
  });
});
