/**
 * Reading what a peer connection is actually carrying.
 *
 * These exist because of a failure that left no evidence: a guest admitted from
 * the waiting room heard the host and was seen by the host, and the host's
 * camera never arrived — on every browser, permanently, while a teammate who
 * joined at the same moment saw that host fine. Every direction worked but one,
 * and nothing in the app could say which.
 */
import {
  formatTransceivers,
  looksLikeMissingVideo,
  summarizeTransceivers,
  videoSenderNeedsRepair,
  type MediaStreamTrackLike,
} from "./media-repair";

const track = (over: Partial<MediaStreamTrackLike> = {}): MediaStreamTrackLike => ({
  kind: "video", enabled: true, muted: false, readyState: "live", ...over,
});

describe("summarizeTransceivers", () => {
  it("names a transceiver that agreed to send and has nothing to send", () => {
    // The leading suspect: an m-line exists and was negotiated sendrecv, so the
    // connection looks healthy, and no frames can ever leave.
    const [video] = summarizeTransceivers([
      { direction: "sendrecv", currentDirection: "sendrecv", sender: { track: null }, receiver: { track: track() } },
    ]);
    expect(video.sending?.hasTrack).toBe(false);
    expect(video.receiving?.hasTrack).toBe(true);
    expect(video.kind).toBe("video");
  });

  it("records what was negotiated, not only what was asked for", () => {
    // The other suspect: this side wanted to send, and the answer came back
    // one-way. Reading `direction` alone would call that healthy.
    const [video] = summarizeTransceivers([
      { direction: "sendrecv", currentDirection: "recvonly", sender: { track: track() }, receiver: { track: track() } },
    ]);
    expect(video.direction).toBe("sendrecv");
    expect(video.currentDirection).toBe("recvonly");
  });

  it("still names the kind when only one side has a track", () => {
    const [only] = summarizeTransceivers([{ direction: "recvonly", sender: { track: null }, receiver: { track: track({ kind: "audio" }) } }]);
    expect(only.kind).toBe("audio");
  });

  it("reports a transceiver with neither side attached rather than skipping it", () => {
    const [dead] = summarizeTransceivers([{ direction: "inactive", sender: { track: null }, receiver: { track: null } }]);
    expect(dead.kind).toBe("unknown");
    expect(dead.sending?.hasTrack).toBe(false);
    expect(dead.receiving?.hasTrack).toBe(false);
  });
});

describe("formatTransceivers", () => {
  it("makes the empty sender the loud part of the line", () => {
    const line = formatTransceivers(summarizeTransceivers([
      { direction: "sendrecv", currentDirection: "sendrecv", sender: { track: null }, receiver: { track: track() } },
    ]));
    expect(line).toContain("NO TRACK");
    expect(line).toContain("want=sendrecv");
    expect(line).toContain("got=sendrecv");
  });

  it("says so when nothing has been negotiated yet", () => {
    expect(formatTransceivers(summarizeTransceivers([
      { direction: "sendrecv", sender: { track: track() }, receiver: { track: null } },
    ]))).toContain("got=pending");
  });

  it("does not pretend there is something to show", () => {
    expect(formatTransceivers([])).toBe("(no transceivers)");
  });
});

describe("videoSenderNeedsRepair", () => {
  it("repairs a sender holding nothing while the camera is live", () => {
    expect(videoSenderNeedsRepair(null, track())).toBe(true);
  });

  it("repairs a sender holding a track that has ended", () => {
    expect(videoSenderNeedsRepair(track({ readyState: "ended" }), track())).toBe(true);
  });

  it("leaves a sender that already holds the live local track", () => {
    const live = track();
    expect(videoSenderNeedsRepair(live, live)).toBe(false);
  });

  it("leaves a camera that is switched off alone", () => {
    // A disabled track is a person's choice, not a fault. Replacing it would
    // turn their camera back on for the whole room.
    const off = track({ enabled: false });
    expect(videoSenderNeedsRepair(off, off)).toBe(false);
  });

  it("does nothing when there is no local camera to attach", () => {
    expect(videoSenderNeedsRepair(null, null)).toBe(false);
    expect(videoSenderNeedsRepair(null, track({ readyState: "ended" }))).toBe(false);
  });
});

describe("looksLikeMissingVideo", () => {
  const base = { connectionState: "connected", connectedForMs: 10_000, peerSaysCameraOn: true, hasInboundVideoTrack: false };

  it("is the reported symptom exactly", () => {
    expect(looksLikeMissingVideo(base)).toBe(true);
  });

  it("stays quiet while the connection is still settling", () => {
    // Video legitimately arrives a beat after audio; complaining at once would
    // cry wolf on every healthy call.
    expect(looksLikeMissingVideo({ ...base, connectedForMs: 500 })).toBe(false);
  });

  it("stays quiet when the peer says their camera is off", () => {
    expect(looksLikeMissingVideo({ ...base, peerSaysCameraOn: false })).toBe(false);
  });

  it("stays quiet once video is actually arriving", () => {
    expect(looksLikeMissingVideo({ ...base, hasInboundVideoTrack: true })).toBe(false);
  });

  it("stays quiet on a connection that is not up", () => {
    // A failed or connecting peer has its own reporting; this is only for the
    // case that looks healthy and is not.
    expect(looksLikeMissingVideo({ ...base, connectionState: "connecting" })).toBe(false);
  });
});
