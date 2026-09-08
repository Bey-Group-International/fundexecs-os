import {
  DISCONNECT_GRACE_MS,
  INITIAL_LINK,
  INITIAL_RECOVERY,
  connectionStateFromIce,
  contentHintFor,
  isPolite,
  linkNotice,
  nextRecovery,
  offerCollision,
  peerLinkStatus,
  peerStatusLabel,
  recordAttempt,
  screenSendCap,
  stepLink,
  videoSendCap,
  withOpusResilience,
  type LinkSample,
  type LinkState,
} from "./connection";

describe("isPolite", () => {
  it("gives the two sides of a pair opposite answers", () => {
    expect(isPolite("aaa", "bbb")).toBe(true);
    expect(isPolite("bbb", "aaa")).toBe(false);
  });

  it("is stable — the same pair always resolves the same way", () => {
    const a = "0f1c-9a";
    const b = "0f1c-9b";
    expect(isPolite(a, b)).toBe(!isPolite(b, a));
    expect(isPolite(a, b)).toBe(isPolite(a, b));
  });
});

describe("offerCollision", () => {
  it("accepts an offer that arrives with nothing in flight", () => {
    expect(offerCollision({ signalingState: "stable", makingOffer: false, polite: false })).toBe("accept");
  });

  it("makes the polite peer roll its own offer back", () => {
    expect(offerCollision({ signalingState: "have-local-offer", makingOffer: true, polite: true }))
      .toBe("rollback_then_accept");
  });

  it("makes the impolite peer ignore the crossing offer", () => {
    expect(offerCollision({ signalingState: "have-local-offer", makingOffer: true, polite: false }))
      .toBe("ignore");
  });

  it("counts an offer still being created as a collision", () => {
    // setLocalDescription has not resolved yet, so signalingState is still
    // stable — the flag is the only evidence that we are mid-offer.
    expect(offerCollision({ signalingState: "stable", makingOffer: true, polite: false })).toBe("ignore");
  });
});

describe("videoSendCap", () => {
  it("divides the upstream budget as the room grows", () => {
    const two = videoSendCap(1)!;
    const five = videoSendCap(4)!;
    expect(five.maxBitrate).toBeLessThan(two.maxBitrate);
  });

  it("caps a one-to-one call rather than spending the whole budget on it", () => {
    expect(videoSendCap(1)!.maxBitrate).toBe(1_200_000);
  });

  it("never falls below a floor where video is worse than none", () => {
    expect(videoSendCap(50)!.maxBitrate).toBe(150_000);
  });

  it("drops resolution and frame rate with the bitrate, not separately", () => {
    const roomy = videoSendCap(1)!;
    const tight = videoSendCap(12)!;
    expect(roomy.scaleResolutionDownBy).toBe(1);
    expect(roomy.maxFramerate).toBe(30);
    expect(tight.scaleResolutionDownBy).toBeGreaterThan(1);
    expect(tight.maxFramerate).toBeLessThan(30);
  });

  it("halves the budget again in degraded mode", () => {
    expect(videoSendCap(2, "degraded")!.maxBitrate).toBeLessThan(videoSendCap(2, "normal")!.maxBitrate);
  });

  it("has nothing to say once video is off", () => {
    expect(videoSendCap(3, "audio-only")).toBeNull();
  });

  it("treats a nonsense peer count as one peer", () => {
    expect(videoSendCap(0)).toEqual(videoSendCap(1));
    expect(videoSendCap(-4)).toEqual(videoSendCap(1));
  });
});

describe("screenSendCap", () => {
  it("keeps full resolution and spends the frames instead", () => {
    const cap = screenSendCap(3)!;
    expect(cap.scaleResolutionDownBy).toBe(1);
    expect(cap.maxFramerate).toBeLessThan(videoSendCap(3)!.maxFramerate);
  });

  it("is absent in audio-only, like the camera", () => {
    expect(screenSendCap(3, "audio-only")).toBeNull();
  });
});

describe("stepLink", () => {
  const bad: LinkSample = { kbps: 40, lossPct: 12 };
  const good: LinkSample = { kbps: 800, lossPct: 0 };

  const run = (start: LinkState, samples: Array<LinkSample | null>) =>
    samples.reduce<LinkState>((s, sample) => stepLink(s, sample), start);

  it("ignores a single bad sample", () => {
    expect(stepLink(INITIAL_LINK, bad).mode).toBe("normal");
  });

  it("steps down one tier after two consecutive bad samples", () => {
    expect(run(INITIAL_LINK, [bad, bad]).mode).toBe("degraded");
  });

  it("reaches audio-only only after degrading first", () => {
    expect(run(INITIAL_LINK, [bad, bad, bad, bad]).mode).toBe("audio-only");
  });

  it("does not go below audio-only", () => {
    expect(run(INITIAL_LINK, [bad, bad, bad, bad, bad, bad]).mode).toBe("audio-only");
  });

  it("needs a longer good run to climb back than to fall", () => {
    const degraded = run(INITIAL_LINK, [bad, bad]);
    expect(stepLink(stepLink(degraded, good), good).mode).toBe("degraded");
    expect(run(degraded, [good, good, good]).mode).toBe("normal");
  });

  it("climbs back one tier at a time", () => {
    const off = run(INITIAL_LINK, [bad, bad, bad, bad]);
    expect(run(off, [good, good, good]).mode).toBe("degraded");
    expect(run(off, [good, good, good, good, good, good]).mode).toBe("normal");
  });

  it("does not let a bad sample and a good one alternate their way anywhere", () => {
    expect(run(INITIAL_LINK, [bad, good, bad, good, bad, good]).mode).toBe("normal");
  });

  it("reads an idle line as no evidence rather than as a dead one", () => {
    // Nothing received yet: zero bytes is what a call looks like before the
    // first frame lands, and must not be mistaken for a starved link.
    expect(run(INITIAL_LINK, [{ kbps: 0, lossPct: 0 }, { kbps: 0, lossPct: 0 }]).mode).toBe("normal");
  });

  it("leaves the streaks alone when there was nothing to measure", () => {
    const one = stepLink(INITIAL_LINK, bad);
    expect(stepLink(one, null)).toEqual(one);
  });

  it("degrades on loss alone, even when the bytes are flowing", () => {
    // The case the byte-rate check misses entirely: plenty of throughput and a
    // quarter of the packets arriving broken is exactly what static sounds like.
    expect(run(INITIAL_LINK, [{ kbps: 900, lossPct: 25 }, { kbps: 900, lossPct: 25 }]).mode).toBe("degraded");
  });
});

describe("linkNotice", () => {
  it("says nothing when the line is fine", () => {
    expect(linkNotice("normal")).toBeNull();
  });

  it("explains a paused camera so it does not read as a bug", () => {
    expect(linkNotice("audio-only")).toMatch(/audio/i);
    expect(linkNotice("degraded")).toMatch(/quality/i);
  });
});

describe("nextRecovery", () => {
  it("restarts immediately the first time", () => {
    expect(nextRecovery(INITIAL_RECOVERY, 1000)).toBe("restart");
  });

  it("waits out the backoff before trying again", () => {
    const after = recordAttempt(INITIAL_RECOVERY, 1000);
    expect(nextRecovery(after, 1500)).toBe("wait");
    expect(nextRecovery(after, 4000)).toBe("restart");
  });

  it("backs off further with each attempt", () => {
    let state = INITIAL_RECOVERY;
    for (let i = 0; i < 3; i++) state = recordAttempt(state, 0);
    expect(nextRecovery(state, 3000)).toBe("wait");
    expect(nextRecovery(state, 20_000)).toBe("restart");
  });

  it("gives up rather than retrying a peer that is gone forever", () => {
    let state = INITIAL_RECOVERY;
    for (let i = 0; i < 5; i++) state = recordAttempt(state, i * 60_000);
    expect(nextRecovery(state, 10_000_000)).toBe("give_up");
  });
});

describe("peerLinkStatus", () => {
  it("holds a brief disconnect back from the screen", () => {
    expect(peerLinkStatus("disconnected", 500)).toBe("live");
    expect(peerLinkStatus("disconnected", DISCONNECT_GRACE_MS + 1)).toBe("reconnecting");
  });

  it("reports a failed connection as reconnecting while restarts are still due", () => {
    expect(peerLinkStatus("failed", 0)).toBe("reconnecting");
  });

  it("says lost once recovery has been given up on", () => {
    expect(peerLinkStatus("connected", 0, true)).toBe("lost");
    expect(peerLinkStatus("closed", 0)).toBe("lost");
  });

  it("has nothing to say about a healthy peer", () => {
    expect(peerStatusLabel(peerLinkStatus("connected", 9999))).toBeNull();
    expect(peerStatusLabel("reconnecting")).toMatch(/reconnect/i);
  });
});

describe("connectionStateFromIce", () => {
  it("reads a completed check as connected, not as something still in progress", () => {
    expect(connectionStateFromIce("completed")).toBe("connected");
    expect(connectionStateFromIce("connected")).toBe("connected");
  });

  it("carries the states a badge acts on straight through", () => {
    expect(connectionStateFromIce("checking")).toBe("connecting");
    expect(connectionStateFromIce("disconnected")).toBe("disconnected");
    expect(connectionStateFromIce("failed")).toBe("failed");
    expect(connectionStateFromIce("closed")).toBe("closed");
  });

  it("leaves an untouched connection alone", () => {
    expect(connectionStateFromIce("new")).toBe("new");
  });

  it("resolves to a live badge for a working connection", () => {
    expect(peerLinkStatus(connectionStateFromIce("completed"), 0)).toBe("live");
  });
});

describe("withOpusResilience", () => {
  const sdp = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10",
    "a=rtpmap:63 red/48000/2",
    "",
  ].join("\r\n");

  it("turns in-band FEC on for the negotiated opus payload", () => {
    expect(withOpusResilience(sdp)).toContain("a=fmtp:111 minptime=10;useinbandfec=1;stereo=0");
  });

  it("keeps the parameters the browser already chose", () => {
    expect(withOpusResilience(sdp)).toContain("minptime=10");
  });

  it("does not overwrite a value that is already set", () => {
    const already = sdp.replace("a=fmtp:111 minptime=10", "a=fmtp:111 minptime=10;stereo=1");
    const out = withOpusResilience(already);
    expect(out).toContain("stereo=1");
    expect(out).not.toContain("stereo=0");
  });

  it("adds an fmtp line for an opus payload that has none", () => {
    const bare = sdp.replace("a=fmtp:111 minptime=10\r\n", "");
    expect(withOpusResilience(bare)).toContain("a=fmtp:111 useinbandfec=1;stereo=0");
  });

  it("leaves an SDP with no opus completely alone", () => {
    const noOpus = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n";
    expect(withOpusResilience(noOpus)).toBe(noOpus);
  });

  it("does not touch another codec's fmtp line", () => {
    const withVideo = `${sdp}a=rtpmap:96 VP8/90000\r\na=fmtp:96 max-fs=12288\r\n`;
    expect(withOpusResilience(withVideo)).toContain("a=fmtp:96 max-fs=12288");
  });

  it("preserves the line endings it was given", () => {
    expect(withOpusResilience(sdp).split("\r\n").length).toBe(sdp.split("\r\n").length);
    const lf = sdp.replace(/\r\n/g, "\n");
    expect(withOpusResilience(lf)).not.toContain("\r\n");
  });

  it("survives an empty description", () => {
    expect(withOpusResilience("")).toBe("");
  });
});

describe("contentHintFor", () => {
  it("tells the encoder a shared screen is text, not a face", () => {
    expect(contentHintFor("screen")).toBe("detail");
    expect(contentHintFor("camera")).toBe("motion");
    expect(contentHintFor("microphone")).toBe("speech");
  });
});
