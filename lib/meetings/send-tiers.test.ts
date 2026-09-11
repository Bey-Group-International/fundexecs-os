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
  withDemotionDelay,
  type VideoTier,
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
