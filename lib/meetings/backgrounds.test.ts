import {
  BACKGROUND_PREF_KEY,
  FRAME_BUDGET_MS,
  NATIVE_TEMPLATES,
  NO_BACKGROUND,
  SLOW_FRAME_RUN,
  UPLOAD_MAX_BYTES,
  MASK_SMOOTHING,
  CONFIDENCE_BACKGROUND,
  CONFIDENCE_PERSON,
  blendCoverage,
  coverageFromConfidence,
  dilateCoverage,
  maskDilatePx,
  maskGrid,
  personCoverage,
  sampleCoverageFromCategory,
  sampleCoverageFromConfidence,
  blurRadiusPx,
  maskFeatherPx,
  decodeEffect,
  effectLabel,
  encodeEffect,
  needsSegmentation,
  shouldSuspendEffect,
  suspensionMessage,
  templateById,
  validateBackgroundUpload,
  type BackgroundEffect,
} from "@/lib/meetings/backgrounds";

describe("blurRadiusPx", () => {
  it("scales with the frame, so one setting looks the same on any camera", () => {
    expect(blurRadiusPx("light", 1280)).toBeGreaterThan(blurRadiusPx("light", 640));
  });

  it("separates slight from extra at the same frame size", () => {
    expect(blurRadiusPx("heavy", 1280)).toBeGreaterThan(blurRadiusPx("light", 1280));
  });

  it("stays visible at small frame sizes rather than rounding to nothing", () => {
    expect(blurRadiusPx("light", 120)).toBeGreaterThanOrEqual(2);
  });

  it("falls back to a sane width for a garbage one", () => {
    expect(blurRadiusPx("light", Number.NaN)).toBe(blurRadiusPx("light", 640));
    expect(blurRadiusPx("light", 0)).toBe(blurRadiusPx("light", 640));
    expect(blurRadiusPx("light", -100)).toBe(blurRadiusPx("light", 640));
  });
});

describe("maskFeatherPx", () => {
  it("softens more on a bigger frame, so the edge looks the same on any camera", () => {
    expect(maskFeatherPx(1280)).toBeGreaterThan(maskFeatherPx(640));
  });

  it("never rounds away to a hard edge on a small frame", () => {
    expect(maskFeatherPx(100)).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a sane width for a garbage one", () => {
    expect(maskFeatherPx(Number.NaN)).toBe(maskFeatherPx(640));
    expect(maskFeatherPx(0)).toBe(maskFeatherPx(640));
  });
});

describe("personCoverage", () => {
  // The selfie segmenter labels only the person, so 0 is the person and 255 is
  // MediaPipe's "no category" filler. Getting this backwards blurs the face and
  // leaves the room sharp, so it is pinned here rather than left to a comment.
  it("covers the person, who is category 0", () => {
    expect(personCoverage(0)).toBe(255);
  });

  it("leaves the background clear, whatever value it arrives as", () => {
    expect(personCoverage(255)).toBe(0);
    expect(personCoverage(1)).toBe(0);
    expect(personCoverage(7)).toBe(0);
  });
});

describe("blendCoverage", () => {
  const person = (n: number) => new Uint8ClampedArray(n).fill(255);
  const background = (n: number) => new Uint8ClampedArray(n).fill(0);

  it("moves toward the new coverage without jumping to it", () => {
    const previous = new Uint8ClampedArray([0, 0, 0]);
    blendCoverage(previous, person(3), 0.5);
    expect([...previous]).toEqual([128, 128, 128]);
  });

  it("converges on the person after a few frames", () => {
    const previous = new Uint8ClampedArray([0]);
    for (let i = 0; i < 6; i++) blendCoverage(previous, person(1), MASK_SMOOTHING);
    expect(previous[0]).toBeGreaterThan(250);
  });

  it("converges on the background just as readily", () => {
    const previous = new Uint8ClampedArray([255]);
    for (let i = 0; i < 6; i++) blendCoverage(previous, background(1), MASK_SMOOTHING);
    expect(previous[0]).toBeLessThan(5);
  });

  it("carries partial coverage through rather than rounding it to a decision", () => {
    // The whole point of a soft mask: a half-covered edge pixel has to stay
    // half-covered, or the ramp collapses back into the staircase it replaced.
    const previous = new Uint8ClampedArray([0]);
    blendCoverage(previous, new Uint8ClampedArray([120]), 1);
    expect(previous[0]).toBe(120);
  });

  it("writes in place rather than allocating a buffer per frame", () => {
    const previous = new Uint8ClampedArray([0]);
    expect(blendCoverage(previous, person(1), 1)).toBe(previous);
  });

  it("takes the new coverage outright at alpha 1, and ignores it at 0", () => {
    const hot = new Uint8ClampedArray([0]);
    blendCoverage(hot, person(1), 1);
    expect(hot[0]).toBe(255);

    const frozen = new Uint8ClampedArray([0]);
    blendCoverage(frozen, person(1), 0);
    expect(frozen[0]).toBe(0);
  });

  it("clamps a nonsense alpha rather than overshooting", () => {
    const over = new Uint8ClampedArray([0]);
    blendCoverage(over, person(1), 5);
    expect(over[0]).toBe(255);
  });

  it("stops at the shorter buffer when the frame size changes mid-call", () => {
    const previous = new Uint8ClampedArray([0, 0]);
    expect(() => blendCoverage(previous, person(8), 1)).not.toThrow();
    expect([...previous]).toEqual([255, 255]);
  });

  it("smooths by default without being told an alpha", () => {
    const previous = new Uint8ClampedArray([0]);
    blendCoverage(previous, person(1));
    expect(previous[0]).toBeGreaterThan(0);
    expect(previous[0]).toBeLessThan(255);
  });
});

describe("coverageFromConfidence", () => {
  it("believes the model well before it is certain", () => {
    // The point of the change. A hat scores nowhere near 0.5, and a halfway
    // threshold is what was throwing it away.
    expect(coverageFromConfidence(0.35)).toBe(255);
    expect(CONFIDENCE_PERSON).toBeLessThan(0.5);
  });

  it("still clears out what the model is confident is not there", () => {
    expect(coverageFromConfidence(0.02)).toBe(0);
    expect(coverageFromConfidence(0)).toBe(0);
  });

  it("ramps through the uncertain band instead of cutting at one number", () => {
    const mid = (CONFIDENCE_BACKGROUND + CONFIDENCE_PERSON) / 2;
    const c = coverageFromConfidence(mid);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(255);
  });

  it("rises monotonically, so more confidence never means less coverage", () => {
    let last = -1;
    for (let c = 0; c <= 1.0001; c += 0.01) {
      const v = coverageFromConfidence(c);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it("treats a garbage confidence as background rather than painting a person", () => {
    expect(coverageFromConfidence(Number.NaN)).toBe(0);
  });
});

describe("maskGrid and maskDilatePx", () => {
  it("carries the mask on a grid far smaller than the frame", () => {
    const g = maskGrid(1280, 720);
    expect(g.width).toBeLessThan(1280 / 3);
    expect(g.scale).toBeGreaterThan(3);
  });

  it("keeps the frame's aspect, so the silhouette is not stretched", () => {
    const g = maskGrid(1280, 720);
    expect(g.width / g.height).toBeCloseTo(1280 / 720, 1);
  });

  it("costs a 1080p camera no more than a 720p one", () => {
    const hd = maskGrid(1280, 720);
    const fhd = maskGrid(1920, 1080);
    expect(fhd.width * fhd.height).toBe(hd.width * hd.height);
  });

  it("never upscales a camera that is already smaller than the grid", () => {
    const g = maskGrid(240, 180);
    expect(g.width).toBe(240);
    expect(g.scale).toBe(1);
  });

  it("widens by the same share of the picture at any resolution", () => {
    // A fixed grid radius would widen a 1080p face half as much as a 720p one.
    const hd = maskGrid(1280, 720);
    const fhd = maskGrid(1920, 1080);
    // As a share of the picture, not as a pixel count: one grid pixel is worth
    // more frame pixels on a bigger camera, which is the point of the grid.
    const shareHd = (maskDilatePx(1280, hd) * hd.scale) / 1280;
    const shareFhd = (maskDilatePx(1920, fhd) * fhd.scale) / 1920;
    expect(shareHd).toBeCloseTo(shareFhd, 3);
  });

  it("always widens by at least something", () => {
    const g = maskGrid(160, 120);
    expect(maskDilatePx(160, g)).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a sane frame for a garbage one", () => {
    expect(maskGrid(Number.NaN, Number.NaN)).toEqual(maskGrid(640, 480));
  });
});

describe("dilateCoverage", () => {
  const gridOf = (w: number, h: number, fill = 0) => new Uint8ClampedArray(w * h).fill(fill);

  it("spreads coverage outward from a covered pixel", () => {
    const w = 21, h = 1;
    const g = gridOf(w, h);
    g[10] = 255;
    dilateCoverage(g, w, h, 4);
    expect(g[10]).toBe(255);
    expect(g[8]).toBeGreaterThan(0);
    expect(g[12]).toBeGreaterThan(0);
  });

  it("fades over the radius rather than ending at a new hard edge", () => {
    const w = 21, h = 1;
    const g = gridOf(w, h);
    g[10] = 255;
    dilateCoverage(g, w, h, 4);
    expect(g[9]).toBeGreaterThan(g[8]);
    expect(g[8]).toBeGreaterThan(g[7]);
  });

  it("spreads vertically as well as horizontally", () => {
    const w = 9, h = 9;
    const g = gridOf(w, h);
    g[4 * w + 4] = 255;
    dilateCoverage(g, w, h, 3);
    expect(g[2 * w + 4]).toBeGreaterThan(0);
    expect(g[6 * w + 4]).toBeGreaterThan(0);
  });

  it("never shrinks anything", () => {
    const w = 16, h = 16;
    const g = gridOf(w, h);
    for (let i = 0; i < g.length; i++) g[i] = i % 7 === 0 ? 255 : 0;
    const before = Uint8ClampedArray.from(g);
    dilateCoverage(g, w, h, 3);
    for (let i = 0; i < g.length; i++) expect(g[i]).toBeGreaterThanOrEqual(before[i]);
  });

  it("leaves an empty mask empty, so a frame with nobody in it stays that way", () => {
    const w = 12, h = 12;
    const g = gridOf(w, h);
    dilateCoverage(g, w, h, 4);
    expect([...g].every((v) => v === 0)).toBe(true);
  });

  it("writes in place, like everything else on the frame path", () => {
    const g = gridOf(4, 4);
    expect(dilateCoverage(g, 4, 4, 2)).toBe(g);
  });

  it("does nothing for a zero radius or a buffer that does not fit", () => {
    const g = gridOf(4, 4); g[5] = 255;
    expect([...dilateCoverage(Uint8ClampedArray.from(g), 4, 4, 0)]).toEqual([...g]);
    expect([...dilateCoverage(Uint8ClampedArray.from(g), 9, 9, 2)]).toEqual([...g]);
  });
});

// ── The still-frame harness ──────────────────────────────────────────────────
//
// A camera cannot run here, so the frames are built rather than captured — and
// built to be the case that was broken. A head the model is sure about, a band
// of headwear above it that the model is only slightly sure about, and room
// around both that it is sure is not a person. Those confidences are the shape
// of the real failure: selfie_segmenter does not score a cap at zero, it scores
// it low, and a halfway threshold discards it.
//
// What makes this a regression test rather than a demonstration: the assertions
// run the shipped pipeline end to end, and the last one fails if anyone raises
// the threshold back toward the model's own verdict.

interface Frame { confidence: Float32Array; width: number; height: number }

/** A 120x120 frame: a head, headwear sitting on it, and a room behind both. */
function frameWithHeadwear(headwearConfidence: number): Frame {
  const width = 120, height = 120;
  const confidence = new Float32Array(width * height).fill(0.02);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // The head: an ellipse the model reads confidently.
      const dx = (x - 60) / 26;
      const dy = (y - 62) / 32;
      if (dx * dx + dy * dy <= 1) confidence[i] = 0.96;
      // The headwear: a band across the top of the head, which the model can
      // see something at but will not commit to.
      else if (y >= 22 && y < 36 && x >= 32 && x < 88) confidence[i] = headwearConfidence;
    }
  }
  return { confidence, width, height };
}

/** Run a built frame through the real mask pipeline and hand back grid coverage. */
function maskFor(frame: Frame): { coverage: Uint8ClampedArray; grid: ReturnType<typeof maskGrid> } {
  const grid = maskGrid(frame.width, frame.height);
  const coverage = new Uint8ClampedArray(grid.width * grid.height);
  sampleCoverageFromConfidence(coverage, frame.confidence, frame.width, frame.height, grid);
  dilateCoverage(coverage, grid.width, grid.height, maskDilatePx(frame.width, grid));
  return { coverage, grid };
}

/** Average coverage over a box given in frame coordinates. */
function coverageOver(
  mask: { coverage: Uint8ClampedArray; grid: ReturnType<typeof maskGrid> },
  x0: number, y0: number, x1: number, y1: number,
): number {
  const { coverage, grid } = mask;
  let sum = 0, n = 0;
  for (let y = Math.floor(y0 / grid.scale); y < Math.ceil(y1 / grid.scale); y++) {
    for (let x = Math.floor(x0 / grid.scale); x < Math.ceil(x1 / grid.scale); x++) {
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      sum += coverage[y * grid.width + x];
      n++;
    }
  }
  return n ? sum / n : 0;
}

describe("headwear survives the mask", () => {
  // Where the band sits, and a patch of room well clear of everything.
  const HEADWEAR = [40, 24, 80, 34] as const;
  const ROOM = [4, 4, 24, 18] as const;

  it("keeps headwear the model is only slightly sure about", () => {
    // 0.28 is the case that was being thrown away: well under a halfway
    // threshold, well over nothing.
    const mask = maskFor(frameWithHeadwear(0.28));
    expect(coverageOver(mask, ...HEADWEAR)).toBeGreaterThan(200);
  });

  it("keeps headwear the model is barely sure about", () => {
    const mask = maskFor(frameWithHeadwear(0.18));
    expect(coverageOver(mask, ...HEADWEAR)).toBeGreaterThan(120);
  });

  it("still keeps the head itself, which was never in doubt", () => {
    const mask = maskFor(frameWithHeadwear(0.28));
    expect(coverageOver(mask, 48, 50, 72, 74)).toBeGreaterThan(240);
  });

  it("does not paint the room in, however generous it is being", () => {
    const mask = maskFor(frameWithHeadwear(0.28));
    expect(coverageOver(mask, ...ROOM)).toBeLessThan(20);
  });

  it("leaves a frame with nobody in it empty", () => {
    const width = 60, height = 60;
    const empty = { confidence: new Float32Array(width * height).fill(0.01), width, height };
    const mask = maskFor(empty);
    expect(Math.max(...mask.coverage)).toBeLessThan(10);
  });

  it("would fail at the threshold the model itself uses", () => {
    // The guard on the guard. If CONFIDENCE_PERSON drifts back up toward 0.5,
    // headwear at 0.28 stops being covered and the tests above go red — this
    // states that dependency outright rather than leaving it implied.
    expect(coverageFromConfidence(0.28)).toBeGreaterThan(200);
    expect(CONFIDENCE_PERSON).toBeLessThanOrEqual(0.35);
  });

  it("recovers headwear the old hard mask dropped outright", () => {
    // The same frame through the fallback path, which is what shipped before:
    // the model's verdict, with nothing above the head in it.
    const frame = frameWithHeadwear(0.28);
    const grid = maskGrid(frame.width, frame.height);
    const labels = new Uint8Array(frame.confidence.length);
    for (let i = 0; i < labels.length; i++) labels[i] = frame.confidence[i] >= 0.5 ? 0 : 255;
    const old = new Uint8ClampedArray(grid.width * grid.height);
    sampleCoverageFromCategory(old, labels, frame.width, frame.height, grid);
    const oldMask = { coverage: old, grid };

    expect(coverageOver(oldMask, ...HEADWEAR)).toBeLessThan(40);
    expect(coverageOver(maskFor(frame), ...HEADWEAR)).toBeGreaterThan(200);
  });
});

describe("native templates", () => {
  it("has unique ids", () => {
    const ids = NATIVE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks one up by id and reports a missing one as null", () => {
    expect(templateById("neural")?.name).toBe("Neural");
    expect(templateById("nope")).toBeNull();
  });

  it("gives every template ordered stops spanning the full axis", () => {
    for (const t of NATIVE_TEMPLATES) {
      expect(t.stops.length).toBeGreaterThanOrEqual(2);
      expect(t.stops[0].at).toBe(0);
      expect(t.stops[t.stops.length - 1].at).toBe(1);
      const ats = t.stops.map((s) => s.at);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    }
  });

  it("keeps gradient axes inside the frame", () => {
    for (const t of NATIVE_TEMPLATES) {
      for (const coord of [...t.from, ...t.to]) {
        expect(coord).toBeGreaterThanOrEqual(0);
        expect(coord).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("validateBackgroundUpload", () => {
  it("accepts the image types a camera background can be", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateBackgroundUpload({ type, size: 1024 }).ok).toBe(true);
    }
  });

  it("rejects a non-image, naming what is allowed", () => {
    const result = validateBackgroundUpload({ type: "application/pdf", size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/JPEG, PNG or WebP/);
  });

  it("rejects an empty file", () => {
    expect(validateBackgroundUpload({ type: "image/png", size: 0 }).ok).toBe(false);
  });

  it("rejects an oversized file, naming the limit", () => {
    const result = validateBackgroundUpload({ type: "image/png", size: UPLOAD_MAX_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/8MB/);
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateBackgroundUpload({ type: "image/png", size: UPLOAD_MAX_BYTES }).ok).toBe(true);
  });
});

describe("shouldSuspendEffect", () => {
  it("leaves a healthy call alone", () => {
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: 0 }))
      .toEqual({ suspend: false, reason: null });
  });

  it("stops decorating frames when video is already being shed for audio", () => {
    expect(shouldSuspendEffect({ bwMode: "audio-only", consecutiveSlowFrames: 0 }))
      .toEqual({ suspend: true, reason: "bandwidth" });
  });

  it("tolerates a single stall rather than judging the machine on it", () => {
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: 1 }).suspend).toBe(false);
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: SLOW_FRAME_RUN - 1 }).suspend).toBe(false);
  });

  it("gives up once slow frames are sustained", () => {
    expect(shouldSuspendEffect({ bwMode: "normal", consecutiveSlowFrames: SLOW_FRAME_RUN }))
      .toEqual({ suspend: true, reason: "cpu" });
  });

  it("blames bandwidth first when both are true — it is the one the user can feel", () => {
    expect(shouldSuspendEffect({ bwMode: "audio-only", consecutiveSlowFrames: 999 }).reason).toBe("bandwidth");
  });

  it("has a frame budget under a 30fps frame time", () => {
    expect(FRAME_BUDGET_MS).toBeLessThan(1000 / 30 * 2);
  });
});

describe("suspensionMessage", () => {
  it("explains bandwidth without blaming the device", () => {
    expect(suspensionMessage("bandwidth")).toMatch(/connection/);
  });

  it("explains cpu without blaming the network", () => {
    expect(suspensionMessage("cpu")).toMatch(/device/);
  });
});

describe("encode / decode", () => {
  const cases: BackgroundEffect[] = [
    { kind: "none" },
    { kind: "blur", strength: "light" },
    { kind: "blur", strength: "heavy" },
    { kind: "template", id: "neural" },
    { kind: "custom", id: "abc-123" },
  ];

  it("round-trips every kind of choice", () => {
    for (const effect of cases) {
      expect(decodeEffect(encodeEffect(effect))).toEqual(effect);
    }
  });

  it("falls back to none for anything it does not recognise", () => {
    for (const raw of [null, undefined, "", "garbage", ":", "blur:", "blur:medium", "template:", "wat:x"]) {
      expect(decodeEffect(raw)).toEqual(NO_BACKGROUND);
    }
  });

  it("drops a template that no longer ships rather than rendering nothing", () => {
    expect(decodeEffect("template:retired-2019")).toEqual(NO_BACKGROUND);
  });

  it("keeps a custom id even though the image may live on another device", () => {
    expect(decodeEffect("custom:missing-here")).toEqual({ kind: "custom", id: "missing-here" });
  });

  it("keeps colons inside an id intact", () => {
    expect(decodeEffect("custom:a:b")).toEqual({ kind: "custom", id: "a:b" });
  });

  it("stores under a namespaced key, like the device preferences beside it", () => {
    expect(BACKGROUND_PREF_KEY.startsWith("fundexecs.")).toBe(true);
  });
});

describe("needsSegmentation", () => {
  it("is false only when there is no effect", () => {
    expect(needsSegmentation({ kind: "none" })).toBe(false);
    expect(needsSegmentation({ kind: "blur", strength: "light" })).toBe(true);
    expect(needsSegmentation({ kind: "template", id: "neural" })).toBe(true);
    expect(needsSegmentation({ kind: "custom", id: "x" })).toBe(true);
  });
});

describe("effectLabel", () => {
  it("uses the words the picker uses", () => {
    expect(effectLabel({ kind: "none" })).toBe("None");
    expect(effectLabel({ kind: "blur", strength: "light" })).toBe("Slight blur");
    expect(effectLabel({ kind: "blur", strength: "heavy" })).toBe("Extra blur");
    expect(effectLabel({ kind: "template", id: "neural" })).toBe("Neural");
    expect(effectLabel({ kind: "custom", id: "x" })).toBe("Your image");
  });

  it("stays readable for a template that has gone", () => {
    expect(effectLabel({ kind: "template", id: "gone" })).toBe("Background");
  });
});
