import {
  browserBrand,
  lineDiagnostics,
  sanitizeDiagnostics,
  MAX_DIAGNOSTICS_BYTES,
} from "./recognizer-diagnostics";

describe("naming the browser behind the engine", () => {
  it("takes the real brand from client hints, past Chromium and the GREASE entry", () => {
    expect(browserBrand(
      [{ brand: "Not_A Brand" }, { brand: "Chromium" }, { brand: "Microsoft Edge" }],
      "Mozilla/5.0 Chrome/141 Edg/141",
    )).toBe("Microsoft Edge");
    expect(browserBrand(
      [{ brand: "Google Chrome" }, { brand: "Chromium" }, { brand: "Not;A=Brand" }],
      "",
    )).toBe("Google Chrome");
  });

  it("falls back to Chromium when hints name nothing else", () => {
    expect(browserBrand([{ brand: "Chromium" }, { brand: "Not.A/Brand" }], "Chrome/141")).toBe("Chromium");
  });

  it("reads the UA string where there are no hints, Edge before Chrome, Safari last", () => {
    expect(browserBrand(null, "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Microsoft Edge");
    expect(browserBrand(undefined, "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15")).toBe("Safari");
    expect(browserBrand(undefined, "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/141.0 Mobile/15E148 Safari/604.1")).toBe("Google Chrome");
    expect(browserBrand(undefined, "Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/145.0")).toBe("Firefox");
    expect(browserBrand(undefined, "Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.0")).toBe("unknown");
    expect(browserBrand(undefined, "")).toBe("");
  });
});

describe("what a line records about its run", () => {
  const run = { path: "track" as const, run: 3, startedAt: 10_000, trackLabel: "Jabra SPEAK 510" };

  it("keeps the engine's score raw, zero included, and null when there was none", () => {
    const base = { brand: "Microsoft Edge", available: true, run, lang: "en-US", now: 12_500 };
    expect(lineDiagnostics({ ...base, engineConfidence: 0 }).engineConfidence).toBe(0);
    expect(lineDiagnostics({ ...base, engineConfidence: 0.42 }).engineConfidence).toBe(0.42);
    expect(lineDiagnostics({ ...base, engineConfidence: undefined }).engineConfidence).toBeNull();
    expect(lineDiagnostics({ ...base, engineConfidence: Number.NaN }).engineConfidence).toBeNull();
  });

  it("says how the run started, which run it was, and how old it was", () => {
    const d = lineDiagnostics({
      brand: "Microsoft Edge", available: true, run, engineConfidence: 1, lang: "en-US", now: 12_500,
    });
    expect(d).toEqual({
      brand: "Microsoft Edge",
      available: true,
      path: "track",
      run: 3,
      runAgeMs: 2_500,
      engineConfidence: 1,
      trackLabel: "Jabra SPEAK 510",
      lang: "en-US",
    });
  });

  it("has no age for a run whose start was never seen", () => {
    const d = lineDiagnostics({
      brand: "Safari", available: false, run: { ...run, startedAt: null, path: "bare" },
      engineConfidence: null, lang: "en-GB", now: 5,
    });
    expect(d.runAgeMs).toBeNull();
    expect(d.path).toBe("bare");
  });
});

describe("what the save route keeps of a client's diagnostics", () => {
  it("keeps the known keys at their types and nothing else", () => {
    expect(sanitizeDiagnostics({
      brand: "Microsoft Edge", available: true, path: "track", run: 2, runAgeMs: 900,
      engineConfidence: 0, trackLabel: "Mic", lang: "en-US", extra: { nested: true },
    })).toEqual({
      brand: "Microsoft Edge", available: true, path: "track", run: 2, runAgeMs: 900,
      engineConfidence: 0, trackLabel: "Mic", lang: "en-US",
    });
  });

  it("refuses anything that is not a run record", () => {
    expect(sanitizeDiagnostics(undefined)).toBeNull();
    expect(sanitizeDiagnostics("track")).toBeNull();
    expect(sanitizeDiagnostics({ brand: "x" })).toBeNull();
    expect(sanitizeDiagnostics({ path: "sideways" })).toBeNull();
  });

  it("coerces the odd value rather than dropping the record", () => {
    expect(sanitizeDiagnostics({ path: "bare", run: "7", engineConfidence: "0.5", available: "yes" })).toEqual({
      brand: "", available: false, path: "bare", run: 0, runAgeMs: null,
      engineConfidence: null, trackLabel: null, lang: "",
    });
  });

  it("bounds the strings so a client cannot fill the column", () => {
    const d = sanitizeDiagnostics({ path: "track", trackLabel: "x".repeat(5_000), brand: "y".repeat(500) })!;
    expect(d.trackLabel).toHaveLength(120);
    expect(d.brand).toHaveLength(60);
    expect(JSON.stringify(d).length).toBeLessThanOrEqual(MAX_DIAGNOSTICS_BYTES);
  });
});
