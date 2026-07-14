import { ease, EASINGS } from "./easing";
import { sampleTrack, sampleClip, isClipFinished } from "./sampler";
import { CLIPS, getClip } from "./clips";
import { AvatarAnimator } from "./player";
import type { Clip, Track } from "./types";

describe("easing", () => {
  it("every curve maps the interval endpoints", () => {
    for (const fn of Object.values(EASINGS)) {
      expect(fn(0)).toBe(0);
    }
    // hold is the exception (steps at the next key), all others reach 1 at t=1.
    for (const [name, fn] of Object.entries(EASINGS)) {
      if (name !== "hold") expect(fn(1)).toBeCloseTo(1, 6);
    }
  });

  it("clamps out-of-range t", () => {
    expect(ease("linear", -1)).toBe(0);
    expect(ease("linear", 2)).toBe(1);
  });

  it("easeInOut is symmetric around 0.5", () => {
    expect(ease("easeInOut", 0.5)).toBeCloseTo(0.5, 6);
    expect(ease("easeInOut", 0.25) + ease("easeInOut", 0.75)).toBeCloseTo(1, 6);
  });
});

describe("sampleTrack", () => {
  const track: Track = {
    channel: "breatheY",
    keys: [
      { t: 0, value: 0, ease: "linear" },
      { t: 100, value: 10, ease: "linear" },
      { t: 200, value: 0, ease: "linear" },
    ],
  };

  it("clamps before the first and after the last key", () => {
    expect(sampleTrack(track, -50)).toBe(0);
    expect(sampleTrack(track, 500)).toBe(0);
    expect(sampleTrack(track, 0)).toBe(0);
    expect(sampleTrack(track, 200)).toBe(0);
  });

  it("interpolates linearly within a segment", () => {
    expect(sampleTrack(track, 50)).toBeCloseTo(5, 6);
    expect(sampleTrack(track, 150)).toBeCloseTo(5, 6);
  });

  it("returns the single key value for a one-key track", () => {
    expect(sampleTrack({ channel: "leanX", keys: [{ t: 0, value: 7 }] }, 999)).toBe(7);
  });

  it("respects the segment's easing curve", () => {
    const eased: Track = { channel: "breatheY", keys: [{ t: 0, value: 0, ease: "easeIn" }, { t: 100, value: 100 }] };
    // easeIn(0.5) = 0.25 → 25
    expect(sampleTrack(eased, 50)).toBeCloseTo(25, 6);
  });
});

describe("sampleClip", () => {
  const loopClip: Clip = {
    name: "t",
    durationMs: 200,
    loop: true,
    tracks: [{ channel: "breatheY", keys: [{ t: 0, value: 0, ease: "linear" }, { t: 100, value: 10, ease: "linear" }, { t: 200, value: 0, ease: "linear" }] }],
  };

  it("wraps time for looping clips", () => {
    expect(sampleClip(loopClip, 50).breatheY).toBeCloseTo(5, 6);
    expect(sampleClip(loopClip, 250).breatheY).toBeCloseTo(5, 6); // 250 % 200 = 50
    expect(sampleClip(loopClip, -150).breatheY).toBeCloseTo(5, 6); // negative wraps to 50
  });

  it("clamps time for one-shot clips and reports finished", () => {
    const oneShot: Clip = { ...loopClip, loop: false };
    expect(sampleClip(oneShot, 999).breatheY).toBe(0); // clamped to t=200
    expect(isClipFinished(oneShot, 999)).toBe(true);
    expect(isClipFinished(loopClip, 999)).toBe(false);
  });

  it("only emits channels the clip drives", () => {
    expect(Object.keys(sampleClip(loopClip, 10))).toEqual(["breatheY"]);
  });
});

describe("clip library", () => {
  it("has sorted keyframes and matching durations", () => {
    for (const clip of Object.values(CLIPS)) {
      expect(clip.durationMs).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        for (let i = 1; i < track.keys.length; i++) {
          expect(track.keys[i].t).toBeGreaterThanOrEqual(track.keys[i - 1].t);
        }
        // keys stay within the clip duration
        expect(track.keys[track.keys.length - 1].t).toBeLessThanOrEqual(clip.durationMs);
      }
    }
  });

  it("idleBreathe loops and returns near its start value after a full period", () => {
    const c = getClip("idleBreathe");
    expect(c.loop).toBe(true);
    expect(sampleClip(c, 0).breatheY ?? 0).toBeCloseTo(sampleClip(c, c.durationMs).breatheY ?? 0, 6);
  });
});

describe("AvatarAnimator", () => {
  it("plays the initial clip and advances", () => {
    const a = new AvatarAnimator("idleBreathe");
    expect(a.current).toBe("idleBreathe");
    a.update(700);
    expect(typeof a.sample().breatheY).toBe("number");
  });

  it("switching clips cross-fades from the prior pose", () => {
    const a = new AvatarAnimator("idleBreathe");
    a.update(700);
    a.play("present", { blendMs: 200 });
    expect(a.current).toBe("present");
    // Immediately after the switch, the blend is ~0 → sample stays near the old pose,
    // not yet the new clip's full value. After the blend completes it matches the clip.
    const early = a.sample();
    a.update(200);
    const settled = a.sample();
    expect(early).not.toEqual(settled);
    expect(settled.gestureRaise).toBeCloseTo(0.85, 2); // present holds gestureRaise at 0.85
  });

  it("play() is a no-op for the same clip unless restart", () => {
    const a = new AvatarAnimator("type");
    a.update(100);
    a.play("type");
    a.update(100);
    // Still advancing the same clock (not reset): 200ms in.
    expect(a.current).toBe("type");
    a.play("type", { restart: true });
    expect(a.isFinished()).toBe(false);
  });

  it("reports a one-shot as finished after its duration", () => {
    const a = new AvatarAnimator("wave");
    a.update(getClip("wave").durationMs + 10);
    expect(a.isFinished()).toBe(true);
  });
});
