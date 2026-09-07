import {
  BACKGROUND_PREF_KEY,
  FRAME_BUDGET_MS,
  NATIVE_TEMPLATES,
  NO_BACKGROUND,
  SLOW_FRAME_RUN,
  UPLOAD_MAX_BYTES,
  MASK_SMOOTHING,
  blendMask,
  personCoverage,
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

describe("blendMask", () => {
  const person = (n: number) => new Uint8Array(n).fill(0);
  const background = (n: number) => new Uint8Array(n).fill(255);

  it("moves toward the new mask without jumping to it", () => {
    const previous = new Uint8ClampedArray([0, 0, 0]);
    blendMask(previous, person(3), 0.5);
    expect([...previous]).toEqual([128, 128, 128]);
  });

  it("converges on the person after a few frames", () => {
    const previous = new Uint8ClampedArray([0]);
    for (let i = 0; i < 6; i++) blendMask(previous, person(1), MASK_SMOOTHING);
    expect(previous[0]).toBeGreaterThan(250);
  });

  it("converges on the background just as readily", () => {
    const previous = new Uint8ClampedArray([255]);
    for (let i = 0; i < 6; i++) blendMask(previous, background(1), MASK_SMOOTHING);
    expect(previous[0]).toBeLessThan(5);
  });

  it("treats every label but the person's as background, not just 255", () => {
    const previous = new Uint8ClampedArray([255, 255]);
    blendMask(previous, new Uint8Array([3, 255]), 1);
    expect([...previous]).toEqual([0, 0]);
  });

  it("writes in place rather than allocating a buffer per frame", () => {
    const previous = new Uint8ClampedArray([0]);
    expect(blendMask(previous, person(1), 1)).toBe(previous);
  });

  it("takes the new mask outright at alpha 1, and ignores it at 0", () => {
    const hot = new Uint8ClampedArray([0]);
    blendMask(hot, person(1), 1);
    expect(hot[0]).toBe(255);

    const frozen = new Uint8ClampedArray([0]);
    blendMask(frozen, person(1), 0);
    expect(frozen[0]).toBe(0);
  });

  it("clamps a nonsense alpha rather than overshooting the mask", () => {
    const over = new Uint8ClampedArray([0]);
    blendMask(over, person(1), 5);
    expect(over[0]).toBe(255);
  });

  it("stops at the shorter buffer when the frame size changes mid-call", () => {
    const previous = new Uint8ClampedArray([0, 0]);
    expect(() => blendMask(previous, person(8), 1)).not.toThrow();
    expect([...previous]).toEqual([255, 255]);
  });

  it("smooths by default without being told an alpha", () => {
    const previous = new Uint8ClampedArray([0]);
    blendMask(previous, person(1));
    expect(previous[0]).toBeGreaterThan(0);
    expect(previous[0]).toBeLessThan(255);
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
