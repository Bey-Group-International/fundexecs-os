// lib/market-sentiment.test.ts
// Unit tests for the deterministic sentiment scorer + news-signal bridge. No I/O.
import {
  scoreSentiment,
  sentimentLabel,
  sentimentToStrength,
  buildNewsSignal,
} from "@/lib/market-sentiment";

describe("scoreSentiment", () => {
  it("is neutral for text with no polarity terms", () => {
    const r = scoreSentiment("The company held its annual meeting on Tuesday");
    expect(r.score).toBe(0);
    expect(r.magnitude).toBe(0);
  });

  it("scores clearly positive coverage above zero", () => {
    const r = scoreSentiment("Record profit and strong growth drive a bullish rally");
    expect(r.score).toBeGreaterThan(0.2);
    expect(r.positiveHits.length).toBeGreaterThan(0);
  });

  it("scores clearly negative coverage below zero", () => {
    const r = scoreSentiment("Bankruptcy fears grow after a fraud probe and heavy losses");
    expect(r.score).toBeLessThan(-0.2);
    expect(r.negativeHits.length).toBeGreaterThan(0);
  });

  it("flips polarity on a negator", () => {
    const plain = scoreSentiment("growth");
    const negated = scoreSentiment("no growth");
    expect(plain.score).toBeGreaterThan(0);
    expect(negated.score).toBeLessThan(0);
  });

  it("is deterministic", () => {
    const text = "strong beat but a lawsuit warning";
    expect(scoreSentiment(text)).toEqual(scoreSentiment(text));
  });
});

describe("sentimentLabel", () => {
  it("buckets by the neutral band", () => {
    expect(sentimentLabel(0.5)).toBe("positive");
    expect(sentimentLabel(-0.5)).toBe("negative");
    expect(sentimentLabel(0.1)).toBe("neutral");
  });
});

describe("sentimentToStrength", () => {
  it("maps magnitude to 0–100", () => {
    expect(sentimentToStrength(0)).toBe(0);
    expect(sentimentToStrength(-1)).toBe(100);
    expect(sentimentToStrength(0.5)).toBe(50);
  });
});

describe("buildNewsSignal", () => {
  const entity = { entityId: "e1", subjectName: "Acme Capital", kind: "company" as const };

  it("returns a news signal with sentiment metadata", () => {
    const sig = buildNewsSignal(entity, [
      "Acme posts record profit",
      "Analysts upgrade Acme on strong growth",
    ]);
    expect(sig).not.toBeNull();
    expect(sig!.signalType).toBe("news");
    expect(sig!.strength).toBeGreaterThan(0);
    expect(sig!.subjectName).toBe("Acme Capital");
    expect((sig!.metadata as { label: string }).label).toBe("positive");
    expect(sig!.summary).toContain("2 recent headlines");
  });

  it("carries a negative lean for bad news", () => {
    const sig = buildNewsSignal(entity, ["Acme faces fraud probe and bankruptcy fears"]);
    expect((sig!.metadata as { label: string }).label).toBe("negative");
    expect(sig!.summary).toContain("1 recent headline");
  });

  it("returns null for empty or purely neutral coverage", () => {
    expect(buildNewsSignal(entity, [])).toBeNull();
    expect(buildNewsSignal(entity, ["   ", ""])).toBeNull();
    expect(buildNewsSignal(entity, ["The company held its annual meeting"])).toBeNull();
  });
});
