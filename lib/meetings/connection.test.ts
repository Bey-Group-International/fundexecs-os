import {
  DISCONNECT_GRACE_MS,
  INITIAL_LINK,
  INITIAL_RECOVERY,
  canSetLocalOffer,
  connectionStateFromIce,
  peerConfig,
  shouldForceRelay,
  contentHintFor,
  isPolite,
  linkNotice,
  ICE_BURST_ATTEMPTS,
  ICE_GIVE_UP_MS,
  ICE_RETRY_CADENCE_MS,
  msUntilNextAttempt,
  nextRecovery,
  summarizeInbound,
  recoveryExhausted,
  withImmediateRetry,
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

describe("summarizeInbound", () => {
  const rate = (id: string, kbps: number) => ({ id, kbps });

  it("has nothing to say when there is nothing to measure", () => {
    expect(summarizeInbound({
      rates: [], expectingVideoFrom: new Set(), lostPackets: 0, deliveredPackets: 0,
    })).toBeNull();
  });

  // The case the old room-average could not see, under a comment claiming it
  // was the case it existed for.
  it("reports the worst stream, not the average of the room", () => {
    const sample = summarizeInbound({
      rates: [rate("a", 40), rate("b", 900), rate("c", 900)],
      expectingVideoFrom: new Set(["a", "b", "c"]),
      lostPackets: 0,
      deliveredPackets: 1_000,
    })!;

    expect(sample.kbps).toBe(40);
    expect(sample.videoExpected).toBe(true);
  });

  // Seven people, one camera on, everybody else silent — and DTX means silence
  // costs almost nothing. The mean was about 37kbps and read as a dying link.
  it("does not let silent listeners drag a healthy stream down", () => {
    const sample = summarizeInbound({
      rates: [rate("talker", 400), ...["a", "b", "c", "d", "e"].map((id) => rate(id, 4))],
      expectingVideoFrom: new Set(["talker"]),
      lostPackets: 0,
      deliveredPackets: 1_000,
    })!;

    expect(sample.kbps).toBe(400);
  });

  // Backgrounding the tab drops every tier to `none`, and the peers stop
  // sending exactly as instructed. Their cameras are still on, so the old rule
  // expected video it had itself cancelled and condemned the line for it.
  it("expects no video from a peer it told to stop sending", () => {
    const sample = summarizeInbound({
      rates: [rate("a", 12), rate("b", 9)],
      expectingVideoFrom: new Set(),
      lostPackets: 0,
      deliveredPackets: 500,
    })!;

    expect(sample.videoExpected).toBe(false);
    // The mean, which still says packets are flowing — that is what tells a
    // link in audio-only that it has recovered.
    expect(sample.kbps).toBe(10.5);
  });

  it("ignores a peer we are not expecting video from when picking the worst", () => {
    const sample = summarizeInbound({
      rates: [rate("watching", 600), rate("camera-off", 3)],
      expectingVideoFrom: new Set(["watching"]),
      lostPackets: 0,
      deliveredPackets: 1_000,
    })!;

    expect(sample.kbps).toBe(600);
  });

  it("reads loss as a percentage of what was delivered", () => {
    const sample = summarizeInbound({
      rates: [rate("a", 500)], expectingVideoFrom: new Set(["a"]),
      lostPackets: 50, deliveredPackets: 1_000,
    })!;
    expect(sample.lossPct).toBe(5);
  });

  it("calls no loss no loss rather than dividing by nothing", () => {
    const sample = summarizeInbound({
      rates: [rate("a", 0)], expectingVideoFrom: new Set(["a"]),
      lostPackets: 0, deliveredPackets: 0,
    })!;
    expect(sample.lossPct).toBe(0);
    expect(sample.kbps).toBe(0);
  });
});

describe("stepLink", () => {
  const bad: LinkSample = { kbps: 40, lossPct: 12, videoExpected: true };
  const good: LinkSample = { kbps: 800, lossPct: 0, videoExpected: true };
  /** What the wire actually carries once video is paused: a little, cleanly. */
  const quiet: LinkSample = { kbps: 40, lossPct: 0, videoExpected: true };

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
    expect(run(INITIAL_LINK, [
      { kbps: 0, lossPct: 0, videoExpected: true },
      { kbps: 0, lossPct: 0, videoExpected: true },
    ]).mode).toBe("normal");
  });

  it("leaves the streaks alone when there was nothing to measure", () => {
    const one = stepLink(INITIAL_LINK, bad);
    expect(stepLink(one, null)).toEqual(one);
  });

  it("climbs out of audio-only on the quiet, clean line audio-only actually produces", () => {
    // The bug this pins: pausing video is what makes the rate low, so reading
    // that low rate as "still bad" left the room in audio-only for the rest of
    // the call however well the network recovered. Nothing else here can catch
    // it — a sample of 800kbps is not something an audio-only room can produce.
    const off = run(INITIAL_LINK, [bad, bad, bad, bad]);
    expect(off.mode).toBe("audio-only");
    expect(run(off, [quiet, quiet, quiet]).mode).toBe("degraded");
    expect(run(off, [quiet, quiet, quiet, quiet, quiet, quiet]).mode).toBe("normal");
  });

  it("does not climb back out of a link that has gone silent", () => {
    // No packets and therefore no loss is not a healthy line, and must not be
    // read as one just because nothing was dropped.
    const off = run(INITIAL_LINK, [bad, bad, bad, bad]);
    const silent: LinkSample = { kbps: 0, lossPct: 0, videoExpected: true };
    expect(run(off, [silent, silent, silent, silent]).mode).toBe("audio-only");
  });

  it("keeps degrading a reduced line that is still losing packets", () => {
    // Loss keeps its meaning at any rate, which is why it is the one signal
    // still consulted below "normal".
    const degraded = run(INITIAL_LINK, [bad, bad]);
    expect(run(degraded, [{ kbps: 200, lossPct: 20, videoExpected: true },
                          { kbps: 200, lossPct: 20, videoExpected: true }]).mode).toBe("audio-only");
  });

  it("leaves a room with every camera off at full quality", () => {
    // A voice call costs about what a starved link delivers, so the rate alone
    // cannot tell them apart — and degrading an audio-only meeting would put a
    // "weak connection" notice on a call that has nothing wrong with it.
    const cameras_off: LinkSample = { kbps: 40, lossPct: 0, videoExpected: false };
    expect(run(INITIAL_LINK, [cameras_off, cameras_off, cameras_off, cameras_off]).mode).toBe("normal");
  });

  it("still degrades a starved link when somebody is sending video", () => {
    const starved: LinkSample = { kbps: 40, lossPct: 0, videoExpected: true };
    expect(run(INITIAL_LINK, [starved, starved]).mode).toBe("degraded");
  });

  it("degrades on loss alone, even when the bytes are flowing", () => {
    // The case the byte-rate check misses entirely: plenty of throughput and a
    // quarter of the packets arriving broken is exactly what static sounds like.
    expect(run(INITIAL_LINK, [
      { kbps: 900, lossPct: 25, videoExpected: true },
      { kbps: 900, lossPct: 25, videoExpected: true },
    ]).mode).toBe("degraded");
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

  // The defect this replaced: the burst spans about twenty-nine seconds, and
  // running out of it meant never trying again. A laptop asleep for a minute,
  // or a train tunnel, left both ends showing "Connection lost" for the rest of
  // the meeting with no way back but a page reload.
  it("keeps trying after the opening burst is spent", () => {
    let state = INITIAL_RECOVERY;
    let at = 1_000;
    for (let i = 0; i < ICE_BURST_ATTEMPTS; i++) { state = recordAttempt(state, at); at += 30_000; }

    expect(recoveryExhausted(state)).toBe(true);
    expect(nextRecovery(state, at)).toBe("restart");
  });

  it("slows to a cadence rather than backing off forever", () => {
    let state = INITIAL_RECOVERY;
    for (let i = 0; i < 20; i++) state = recordAttempt(state, 1_000 + i * ICE_RETRY_CADENCE_MS);
    const last = 1_000 + 19 * ICE_RETRY_CADENCE_MS;

    expect(msUntilNextAttempt(state, last)).toBe(ICE_RETRY_CADENCE_MS);
    expect(nextRecovery(state, last + ICE_RETRY_CADENCE_MS - 1)).toBe("wait");
    expect(nextRecovery(state, last + ICE_RETRY_CADENCE_MS)).toBe("restart");
  });

  // Measured from when the trouble started, not counted in attempts: what is
  // being judged is how long this peer has been unreachable.
  it("stops once the peer has been unreachable longer than a meeting survives", () => {
    let state = recordAttempt(INITIAL_RECOVERY, 1_000);
    state = recordAttempt(state, 1_000 + ICE_GIVE_UP_MS - 1);

    expect(nextRecovery(state, 1_000 + ICE_GIVE_UP_MS - 1)).toBe("wait");
    expect(nextRecovery(state, 1_000 + ICE_GIVE_UP_MS)).toBe("give_up");
  });

  it("starts the horizon even when the clock reads zero", () => {
    const state = recordAttempt(INITIAL_RECOVERY, 0);
    expect(nextRecovery(state, ICE_GIVE_UP_MS)).toBe("give_up");
  });

  it("has nothing to wait for before the first attempt", () => {
    expect(msUntilNextAttempt(INITIAL_RECOVERY, 5_000)).toBe(0);
  });
});

describe("recoveryExhausted", () => {
  // What the tile SAYS, which is not the same question as whether we are still
  // trying. Conflating the two is how an honest badge became a permanent one.
  it("says nothing until the burst a member waits through is spent", () => {
    let state = INITIAL_RECOVERY;
    for (let i = 0; i < ICE_BURST_ATTEMPTS - 1; i++) {
      state = recordAttempt(state, i * 10_000);
      expect(recoveryExhausted(state)).toBe(false);
    }
    expect(recoveryExhausted(recordAttempt(state, 100_000))).toBe(true);
  });
});

describe("withImmediateRetry", () => {
  // The backoff is arithmetic about a network nobody can see; `online` is the
  // browser seeing it. Waiting out the rest of a cadence then buys nothing.
  it("makes the next attempt due at once", () => {
    let state = INITIAL_RECOVERY;
    for (let i = 0; i < 8; i++) state = recordAttempt(state, 1_000 + i * ICE_RETRY_CADENCE_MS);
    const now = 1_000 + 7 * ICE_RETRY_CADENCE_MS + 4_000;
    expect(nextRecovery(state, now)).toBe("wait");

    expect(nextRecovery(withImmediateRetry(state), now)).toBe("restart");
  });

  // Otherwise flapping Wi-Fi would be a way to retry a peer that left forever.
  it("does not extend the horizon or forgive the attempts", () => {
    const state = recordAttempt(INITIAL_RECOVERY, 1_000);
    const eager = withImmediateRetry(state);

    expect(eager.attempts).toBe(state.attempts);
    expect(eager.firstAttemptAt).toBe(state.firstAttemptAt);
    expect(nextRecovery(eager, 1_000 + ICE_GIVE_UP_MS)).toBe("give_up");
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
    expect(withOpusResilience(sdp)).toContain("a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;stereo=0");
  });

  it("keeps the parameters the browser already chose", () => {
    expect(withOpusResilience(sdp)).toContain("minptime=10");
  });

  // The one that pays in a mesh: in a six-person call five people are listening
  // at any moment, and each was uploading a separate constant-bitrate stream of
  // their own silence to every other participant.
  it("stops paying to transmit silence", () => {
    expect(withOpusResilience(sdp)).toContain("usedtx=1");
  });

  // Same rule as every other parameter here: a value the browser or another
  // munge already chose is left alone rather than overridden.
  it("does not force DTX back on where it has been turned off", () => {
    const off = sdp.replace("a=fmtp:111 minptime=10", "a=fmtp:111 minptime=10;usedtx=0");
    const out = withOpusResilience(off);
    expect(out).toContain("usedtx=0");
    expect(out).not.toContain("usedtx=1");
  });

  it("does not overwrite a value that is already set", () => {
    const already = sdp.replace("a=fmtp:111 minptime=10", "a=fmtp:111 minptime=10;stereo=1");
    const out = withOpusResilience(already);
    expect(out).toContain("stereo=1");
    expect(out).not.toContain("stereo=0");
  });

  it("adds an fmtp line for an opus payload that has none", () => {
    const bare = sdp.replace("a=fmtp:111 minptime=10\r\n", "");
    expect(withOpusResilience(bare)).toContain("a=fmtp:111 useinbandfec=1;usedtx=1;stereo=0");
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

describe("canSetLocalOffer", () => {
  it("takes an offer on a settled connection", () => {
    expect(canSetLocalOffer("stable")).toBe(true);
  });

  // The whole reason this is not `=== "stable"`. A connection whose offer was
  // never answered sits here for good, and it is the one ICE recovery exists to
  // rescue: refusing to re-offer made every rescue a silent no-op that still
  // spent one of its five attempts, so the peer was declared lost and only a
  // page reload brought it back.
  it("re-offers over an offer that was never answered", () => {
    expect(canSetLocalOffer("have-local-offer")).toBe(true);
  });

  it("stands down when the far end got in first", () => {
    expect(canSetLocalOffer("have-remote-offer")).toBe(false);
  });

  it("refuses the states that genuinely cannot take one", () => {
    expect(canSetLocalOffer("have-local-pranswer")).toBe(false);
    expect(canSetLocalOffer("have-remote-pranswer")).toBe(false);
    expect(canSetLocalOffer("closed")).toBe(false);
  });

  // An ICE restart is the reason this matters, so state the pair together: the
  // impolite side of a collision ignores the incoming offer and relies on its
  // own completing, which it can only do if it was allowed to send one.
  it("lets an impolite peer's own offer proceed after it ignores a collision", () => {
    const action = offerCollision({ signalingState: "have-local-offer", makingOffer: true, polite: false });
    expect(action).toBe("ignore");
    expect(canSetLocalOffer("have-local-offer")).toBe(true);
  });
});

describe("shouldForceRelay", () => {
  it("sends a guest straight to the relay when there is one", () => {
    expect(shouldForceRelay({ isGuest: true, relayAvailable: true })).toBe(true);
  });

  it("leaves signed-in members on the direct path", () => {
    // They are on networks this deployment mostly controls, and relaying them
    // would pay for bandwidth on calls that connect directly.
    expect(shouldForceRelay({ isGuest: false, relayAvailable: true })).toBe(false);
  });

  it("does NOT force a guest through a relay that does not exist", () => {
    // The guard that keeps this from making things worse. Relay-only with no
    // relay server leaves a connection no usable candidates and no direct path
    // to fall back to — a guest on an ordinary home network would go from a
    // working call to one that cannot physically connect.
    expect(shouldForceRelay({ isGuest: true, relayAvailable: false })).toBe(false);
  });

  it("changes nothing for a member on a deployment with no TURN", () => {
    expect(shouldForceRelay({ isGuest: false, relayAvailable: false })).toBe(false);
  });
});

describe("peerConfig", () => {
  it("carries the servers it was given", () => {
    const servers = [{ urls: ["stun:a.example:3478"] }];
    expect(peerConfig(servers).iceServers).toBe(servers);
  });

  // Both of these are a guest's problem before they are anyone's. A call is two
  // m-sections, and under the default policy a browser prepares two transports
  // for them until BUNDLE is agreed in the answer — two candidate gatherings,
  // two sets of connectivity checks, and behind a relay two TURN allocations.
  // The participant most likely to be behind that relay is the guest.
  it("puts audio and video on one transport from the offer onwards", () => {
    expect(peerConfig([]).bundlePolicy).toBe("max-bundle");
  });

  it("multiplexes RTCP rather than giving it a port of its own", () => {
    expect(peerConfig([]).rtcpMuxPolicy).toBe("require");
  });

  // Stated as a test because the omission is deliberate and looks like a gap:
  // pre-gathering only pays when a connection exists well before its offer, and
  // here a peer connection is created and offered on in the same breath — so a
  // pool would buy nothing and open a TURN allocation per candidate to buy it.
  it("does not pre-gather a candidate pool", () => {
    expect(peerConfig([]).iceCandidatePoolSize).toBeUndefined();
  });

  it("leaves the transport policy unset unless relay-only is asked for", () => {
    // Undefined means the browser's "all". Writing that out would claim a
    // decision had been made where none was.
    expect(peerConfig([]).iceTransportPolicy).toBeUndefined();
    expect(peerConfig([], {}).iceTransportPolicy).toBeUndefined();
    expect(peerConfig([], { relayOnly: false }).iceTransportPolicy).toBeUndefined();
  });

  it("forces the relay when asked, and keeps everything else", () => {
    const config = peerConfig([{ urls: "turn:example" }], { relayOnly: true });
    expect(config.iceTransportPolicy).toBe("relay");
    expect(config.bundlePolicy).toBe("max-bundle");
    expect(config.rtcpMuxPolicy).toBe("require");
  });
});
