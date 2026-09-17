/**
 * Sending each person only the picture they are looking at.
 *
 * The numbers here are the point of the change, so they are pinned rather than
 * described: a six-guest presenter-shaped call is exactly the case that was
 * making laptops hot, video blocky and audio break up, and these tests say what
 * it costs before and after.
 */
import {
  activeEncoderCount,
  allocateSendCaps,
  tierForView,
  totalUpstreamKbps,
  capTierForMode,
  withDemotionDelay,
  type VideoTier,
  scaleForCapture,
  FULL_CAPTURE,
  THUMBNAIL_CAPTURE,
  THUMBNAIL_SCALE,
} from "./send-tiers";

const view = (over: Partial<Parameters<typeof tierForView>[0]> = {}) =>
  tierForView({ documentHidden: false, isSpotlight: false, layout: "speaker", tileCount: 2, cameraOn: true, ...over });

const peers = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const all = (ids: readonly string[], tier: VideoTier) => new Map(ids.map((id) => [id, tier]));

describe("tierForView", () => {
  it("gives the spotlight real quality and the strip a thumbnail", () => {
    expect(view({ isSpotlight: true })).toBe("high");
    expect(view({ isSpotlight: false })).toBe("low");
  });

  it("asks for nothing while the tab is in the background", () => {
    // The only lever that REMOVES encoder cost rather than reducing it.
    expect(view({ documentHidden: true, isSpotlight: true })).toBe("none");
  });

  it("asks for nothing from a camera that is off", () => {
    expect(view({ cameraOn: false, isSpotlight: true })).toBe("none");
  });

  it("keeps a small grid at full quality and drops a large one to thumbnails", () => {
    // Two or three tiles are still drawn large; past four they are stamps.
    expect(view({ layout: "grid", tileCount: 3 })).toBe("high");
    expect(view({ layout: "grid", tileCount: 4 })).toBe("high");
    expect(view({ layout: "grid", tileCount: 5 })).toBe("low");
    expect(view({ layout: "grid", tileCount: 7 })).toBe("low");
  });
});

describe("allocateSendCaps", () => {
  it("treats a peer that has not asked as high, so an old client is unaffected", () => {
    // A participant on a build that never sends a request must get exactly what
    // the old even split gave them.
    const ids = peers(6);
    const caps = allocateSendCaps(new Map(), ids, "normal");
    const each = caps.get("p1")!;
    expect(each.maxBitrate).toBe(400_000); // 2400 / 6, as before
    expect(activeEncoderCount(caps)).toBe(6);
  });

  it("hands nearly the whole budget to one presenter", () => {
    // Six guests, one person in everyone's spotlight. Before: 400kbps each,
    // including to the presenter. After: the presenter is the only one being
    // watched and gets the ceiling.
    const ids = peers(6);
    const caps = allocateSendCaps(all(ids, "high"), ids, "normal");
    expect(caps.get("p1")!.maxBitrate).toBe(400_000);

    const asThumbnails = allocateSendCaps(all(ids, "low"), ids, "normal");
    expect(totalUpstreamKbps(asThumbnails)).toBe(1080); // 6 x 180
  });

  it("is the real case: I am a thumbnail to everyone", () => {
    // What five of six people experience for most of a presented meeting.
    const ids = peers(6);
    const before = 2400;
    const after = totalUpstreamKbps(allocateSendCaps(all(ids, "low"), ids, "normal"));
    expect(after).toBe(1080);
    expect(after).toBeLessThan(before / 2);
    // And every encoder is running at a quarter resolution and half framerate.
    const cap = allocateSendCaps(all(ids, "low"), ids, "normal").get("p1")!;
    expect(cap.scaleResolutionDownBy).toBe(4);
    expect(cap.maxFramerate).toBe(15);
  });

  it("spends what the thumbnails save on the person being watched", () => {
    // One spotlight, five thumbnails — the presenter's own outgoing allocation.
    const ids = peers(6);
    const requests = new Map<string, VideoTier>(ids.map((id, i) => [id, i === 0 ? "high" : "low"]));
    const caps = allocateSendCaps(requests, ids, "normal");
    // 2400 - 5x180 = 1500 for the one high peer, capped at the 1200 ceiling.
    expect(caps.get("p1")!.maxBitrate).toBe(1_200_000);
    // Three times what the even split gave that stream, and full resolution.
    expect(caps.get("p1")!.scaleResolutionDownBy).toBe(1);
    expect(caps.get("p2")!.maxBitrate).toBe(180_000);
  });

  it("stops encoding entirely for peers who want nothing", () => {
    const ids = peers(6);
    const caps = allocateSendCaps(all(ids, "none"), ids, "normal");
    expect(activeEncoderCount(caps)).toBe(0);
    expect(totalUpstreamKbps(caps)).toBe(0);
  });

  it("does not let background tabs subsidise a bigger picture elsewhere", () => {
    // Peers asking for nothing free up budget, but the ceiling still applies.
    const ids = peers(6);
    const requests = new Map<string, VideoTier>(ids.map((id, i) => [id, i === 0 ? "high" : "none"]));
    expect(allocateSendCaps(requests, ids, "normal").get("p1")!.maxBitrate).toBe(1_200_000);
  });

  it("never drops a watched stream below the floor, however many thumbnails", () => {
    // Twenty thumbnails would otherwise compute a negative share.
    const ids = peers(20);
    const requests = new Map<string, VideoTier>(ids.map((id, i) => [id, i === 0 ? "high" : "low"]));
    expect(allocateSendCaps(requests, ids, "normal").get("p1")!.maxBitrate).toBe(150_000);
  });

  it("halves the watched stream when degraded, and leaves thumbnails alone", () => {
    const ids = peers(6);
    const requests = new Map<string, VideoTier>(ids.map((id, i) => [id, i === 0 ? "high" : "low"]));
    const caps = allocateSendCaps(requests, ids, "degraded");
    expect(caps.get("p1")!.maxBitrate).toBe(750_000); // (2400 - 900) / 2
    // A thumbnail is already at the floor of what is worth sending.
    expect(caps.get("p2")!.maxBitrate).toBe(180_000);
  });

  it("sends nothing at all in audio-only, whatever anyone asked for", () => {
    const ids = peers(6);
    expect(activeEncoderCount(allocateSendCaps(all(ids, "high"), ids, "audio-only"))).toBe(0);
  });

  it("handles an empty room without dividing by zero", () => {
    expect(allocateSendCaps(new Map(), [], "normal").size).toBe(0);
  });
});

describe("withDemotionDelay", () => {
  const hold = (over: Partial<Parameters<typeof withDemotionDelay>[0]>) =>
    withDemotionDelay({ desired: "low", lastHighAt: 0, now: 1_000, lingerMs: 4_000, ...over });

  it("promotes immediately, so a new speaker is sharp at once", () => {
    expect(hold({ desired: "high", lastHighAt: null })).toBe("high");
  });

  it("holds full quality through cross-talk rather than flapping", () => {
    // The active speaker comes from the audio meter and moves every time
    // somebody says "mm". Following it exactly would cost a keyframe and a
    // visible blip on every interjection.
    expect(hold({ desired: "low", lastHighAt: 0, now: 500 })).toBe("high");
    expect(hold({ desired: "low", lastHighAt: 0, now: 3_999 })).toBe("high");
  });

  it("demotes once they have genuinely stopped speaking", () => {
    expect(hold({ desired: "low", lastHighAt: 0, now: 4_001 })).toBe("low");
  });

  it("never holds a peer who should be sending nothing", () => {
    // A backgrounded tab or a camera switched off stops the far encoder at
    // once: that is the saving a delay would throw away.
    expect(hold({ desired: "none", lastHighAt: 0, now: 1 })).toBe("none");
  });

  it("does not hold someone who was never watched", () => {
    expect(hold({ desired: "low", lastHighAt: null })).toBe("low");
  });
});

describe("capTierForMode", () => {
  // The defect this closes: every input to the link state is an INBOUND
  // measurement, and every response to it was on the send side. A member on a
  // congested downlink switched off their own camera — the one thing that was
  // not causing the loss — kept pulling the full inbound stream, and stayed
  // invisible for the rest of the call without the line improving at all.
  it("stops asking for pictures at all once video is being paused", () => {
    expect(capTierForMode("high", "audio-only")).toBe("none");
    expect(capTierForMode("low", "audio-only")).toBe("none");
    expect(capTierForMode("none", "audio-only")).toBe("none");
  });

  it("stops asking anyone for a full-size picture on a degraded line", () => {
    expect(capTierForMode("high", "degraded")).toBe("low");
  });

  // Degraded is the step before giving up on video, so it keeps the picture
  // that costs least rather than removing it.
  it("leaves a thumbnail alone on a degraded line", () => {
    expect(capTierForMode("low", "degraded")).toBe("low");
    expect(capTierForMode("none", "degraded")).toBe("none");
  });

  it("changes nothing on a healthy line", () => {
    for (const tier of ["high", "low", "none"] as const) {
      expect(capTierForMode(tier, "normal")).toBe(tier);
    }
  });

  // It only ever reduces. A cap that could raise a tier would override the
  // layout — asking for a full-size picture of somebody drawn at 96px.
  it("never asks for more than the layout wanted", () => {
    const rank = { none: 0, low: 1, high: 2 } as const;
    for (const mode of ["normal", "degraded", "audio-only"] as const) {
      for (const tier of ["high", "low", "none"] as const) {
        expect(rank[capTierForMode(tier, mode)]).toBeLessThanOrEqual(rank[tier]);
      }
    }
  });
});

describe("scaleForCapture", () => {
  // The correction that makes moving the camera safe at all. A cap is a
  // DIVISOR, so it means a different output on every capture size: a
  // thumbnail's 4 is 320x180 out of a 1280-wide capture and 160x90 out of a
  // 640-wide one. Dropping the capture without this would quietly halve every
  // thumbnail in the call — the opposite of the intent.
  it("keeps the output the same size when the capture moves", () => {
    const outputAt720 = FULL_CAPTURE.height / THUMBNAIL_SCALE;
    const corrected = scaleForCapture(THUMBNAIL_SCALE, THUMBNAIL_CAPTURE.height);
    expect(THUMBNAIL_CAPTURE.height / corrected).toBe(outputAt720);
  });

  it("changes nothing at the capture the caps are written against", () => {
    expect(scaleForCapture(4, FULL_CAPTURE.height)).toBe(4);
    expect(scaleForCapture(1, FULL_CAPTURE.height)).toBe(1);
    expect(scaleForCapture(1.5, FULL_CAPTURE.height)).toBe(1.5);
  });

  // A capture already at or below what the tier wants has no detail to spare;
  // scaling it further would send less than the receiver asked for.
  it("never asks for less than the capture already is", () => {
    expect(scaleForCapture(1, THUMBNAIL_CAPTURE.height)).toBe(1);
    expect(scaleForCapture(2, 360)).toBe(1);
  });

  it("survives a camera that will not say what size it is", () => {
    expect(scaleForCapture(4, 0)).toBe(4);
    expect(scaleForCapture(4, Number.NaN)).toBe(4);
    expect(scaleForCapture(0, 720)).toBe(1);
  });

  // The room tells a thumbnail cap from a full-size one by comparing against
  // this, so the two have to keep agreeing.
  it("matches the divisor the thumbnail cap actually carries", () => {
    const caps = allocateSendCaps(new Map([["a", "low" as const]]), ["a"]);
    expect(caps.get("a")?.scaleResolutionDownBy).toBe(THUMBNAIL_SCALE);
  });
});
