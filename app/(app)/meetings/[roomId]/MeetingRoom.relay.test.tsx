/**
 * The relay a guest was sent to, when the relay does not work.
 *
 * Invite-link guests are put on `iceTransportPolicy: "relay"` because the direct
 * path they would otherwise try first is the one that fails on the networks they
 * are on. The decision is made from whether a relay was CONFIGURED, which is all
 * the endpoint minting credentials can know: they are computed from a shared
 * secret, or issued by a provider, and nothing allocates anything on the way.
 *
 * So "configured" and "works" are different facts, and on a relay-only
 * connection the difference is the entire call. The policy removes the host and
 * server-reflexive candidates, so a refused or unanswered allocation leaves a
 * connection with NO candidates at all — it cannot fall back to a direct path
 * because it has been told not to have one. Nothing fails, nothing retries,
 * nothing appears on screen: the guest's tile simply never arrives for anybody,
 * and the host spends the meeting unable to see or hear them. A guest on an
 * ordinary home network, who never needed the relay, is worse off than before it
 * was forced on them.
 *
 * These tests enter the real room as a guest and drive ICE gathering by hand,
 * which is the only part of this the browser decides. What a stub cannot fake is
 * which configuration the room builds the NEXT connection with, and that is what
 * every assertion here reads.
 */
import { render, screen, act } from "@testing-library/react";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams("guest=1&name=Ada"),
}));

const joinChoice = { cameraId: "", micId: "", speakerId: "", cameraEnabled: false, micEnabled: false, background: null as unknown };
jest.mock("./MeetingGreenRoom", () => ({
  MeetingGreenRoom: ({ onJoin }: { onJoin: (c: unknown) => void }) => (
    <button onClick={() => onJoin({ ...joinChoice })}>Join now</button>
  ),
}));

const realtime = {
  channels: [] as Array<{ name: string; handlers: Record<string, (m: unknown) => void>; removed: boolean }>,
  reset() { this.channels = []; },
  signal(payload: unknown) {
    for (const c of this.channels) {
      if (c.name.startsWith("meeting:") && !c.removed) c.handlers.signal?.({ payload });
    }
  },
};

const supabaseStub = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  rpc: async () => ({ data: null, error: null }),
  from: () => {
    const b: Record<string, unknown> = {
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: (v: unknown) => unknown) => res({ data: [], error: null }),
    };
    for (const k of ["select", "eq", "neq", "is", "in", "gte", "lte", "not", "or", "filter",
                     "range", "order", "limit", "update", "insert", "upsert", "delete"]) {
      b[k] = () => b;
    }
    return b;
  },
  channel: (name: string) => {
    const entry = { name, handlers: {} as Record<string, (m: unknown) => void>, removed: false };
    realtime.channels.push(entry);
    const api = {
      on: (_t: string, filter: { event?: string }, handler: (m: unknown) => void) => {
        if (filter?.event) entry.handlers[filter.event] = handler;
        return api;
      },
      subscribe: (cb?: (s: string) => void) => { cb?.("SUBSCRIBED"); return entry; },
      send: async () => "ok",
      unsubscribe: async () => "ok",
    };
    return api;
  },
  removeChannel: (c: { removed: boolean }) => { if (c) c.removed = true; },
};
jest.mock("@/lib/supabase/client", () => ({ createClient: () => supabaseStub }));

import { MeetingRoom } from "./MeetingRoom";
import { RELAY_PROBE_MS } from "@/lib/meetings/connection";

const ROOM = "abc-defg-hi";

/** Makes `replaceTrack` never settle, so a repair can still be in flight. */
let hangReplaceTrack = false;

/** What the endpoint says this deployment has. Mutable per test. */
let relayAnswer: { iceServers?: unknown[]; relay?: boolean; reason?: string } = {};

function fakeTrack(kind: string, id = `${kind}-local`) {
  return {
    kind, id, enabled: true, muted: false, readyState: "live",
    getSettings: () => ({ deviceId: `${kind}-dev` }),
    addEventListener: () => {}, removeEventListener: () => {},
    stop: () => {}, applyConstraints: async () => {},
    clone() { return fakeTrack(kind, id); },
  };
}
type FakeTrack = ReturnType<typeof fakeTrack>;

function fakeStream(tracks: FakeTrack[] = []) {
  const list = [...tracks];
  return {
    id: "s-local",
    getTracks: () => list,
    getVideoTracks: () => list.filter((t) => t.kind === "video"),
    getAudioTracks: () => list.filter((t) => t.kind === "audio"),
    addTrack: (t: FakeTrack) => { list.push(t); },
    removeTrack: () => {},
  };
}

/** A sender that reports what it is holding and records every re-attach. */
interface FakeSender { track: FakeTrack | null; replaced: Array<FakeTrack | null> }

/**
 * A peer connection that remembers the configuration it was built with, and
 * whose ICE gathering is driven from the test.
 *
 * The configuration is the whole subject: `iceTransportPolicy` is not
 * observable through any behaviour a stub could imitate, so the only honest way
 * to assert the policy was withdrawn is to read what the room asked for when it
 * built the next connection.
 */
class FakePC {
  static all: FakePC[] = [];
  config: RTCConfiguration;
  connectionState = "connecting";
  iceConnectionState = "checking";
  iceGatheringState = "new";
  signalingState = "stable";
  localDescription = null;
  remoteDescription = null;
  closed = false;
  restarts = 0;
  offers = 0;
  senders: FakeSender[] = [];
  ontrack: unknown = null;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: unknown = null;
  onnegotiationneeded: unknown = null;

  constructor(config: RTCConfiguration = {}) {
    this.config = config;
    FakePC.all.push(this);
  }

  /**
   * Deliberately hands back a sender holding NOTHING, whatever it was given.
   *
   * That is not an idle simplification: a transceiver that was negotiated and
   * whose sender never adopted the track is the exact fault `repairOutgoing*`
   * exists for, and it is invisible from the connection — every state says
   * healthy and not one frame or syllable can leave.
   */
  addTransceiver() {
    const sender: FakeSender = { track: null, replaced: [] };
    (sender as unknown as Record<string, unknown>).replaceTrack = (t: FakeTrack | null) => {
      if (hangReplaceTrack) return new Promise<void>(() => { /* never settles */ });
      sender.replaced.push(t);
      sender.track = t;
      return Promise.resolve();
    };
    (sender as unknown as Record<string, unknown>).setParameters = async () => {};
    (sender as unknown as Record<string, unknown>).getParameters = () => ({ encodings: [{}] });
    this.senders.push(sender);
    return { sender, receiver: {} };
  }
  addTrack() { return this.addTransceiver().sender; }
  getSenders() { return this.senders; }
  getReceivers() { return []; }
  getTransceivers() { return []; }
  async createOffer() { this.offers += 1; return { type: "offer", sdp: "v=0" }; }
  async createAnswer() { return { type: "answer", sdp: "v=0" }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  async getStats() { return new Map(); }
  restartIce() { this.restarts++; }
  close() { this.closed = true; this.signalingState = "closed"; this.connectionState = "closed"; }

  /** Move gathering on and tell the room, the way an engine would. */
  gather(state: "gathering" | "complete") {
    this.iceGatheringState = state;
    this.onicegatheringstatechange?.();
  }
  /** Offer up one candidate, the way an engine would. */
  offerCandidate(candidate: { type?: string; candidate?: string } | null) {
    this.onicecandidate?.({
      candidate: candidate ? { ...candidate, toJSON: () => ({ ...candidate }) } : null,
    });
  }
  /** Move the connection on and tell the room. */
  moveTo(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.clearAllMocks();
  realtime.reset();
  FakePC.all = [];
  hangReplaceTrack = false;
  joinChoice.cameraEnabled = false;
  joinChoice.micEnabled = false;
  relayAnswer = {
    iceServers: [
      { urls: ["stun:stun.example.net:3478"] },
      { urls: ["turn:turn.example.net:3478"], username: "u", credential: "c" },
    ],
    relay: true,
  };
  window.localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const reply = (status: number, body: unknown) => ({
      ok: status >= 200 && status <= 299, status, headers: new Headers(), json: async () => body,
    }) as Response;
    if (url.includes("/api/meetings/ice-servers")) return reply(200, relayAnswer);
    if (url.includes("/knock")) return reply(200, { status: "admitted", admissionId: "adm-1" });
    if (url.includes("/api/meetings/public/")) return reply(200, { id: "m1", title: "Series B Diligence", status: "active" });
    return reply(200, {});
  }) as unknown as typeof fetch;

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => fakeStream([fakeTrack("audio"), fakeTrack("video")]),
      getDisplayMedia: async () => fakeStream([fakeTrack("video")]),
      enumerateDevices: async () => [],
      addEventListener: () => {}, removeEventListener: () => {},
    },
  });

  (global as Record<string, unknown>).RTCPeerConnection = FakePC;
  (global as Record<string, unknown>).MediaStream = class {
    private list: FakeTrack[];
    id = "ms";
    constructor(tracks: FakeTrack[] = []) { this.list = [...tracks]; }
    getTracks() { return this.list; }
    getVideoTracks() { return this.list.filter((t) => t.kind === "video"); }
    getAudioTracks() { return this.list.filter((t) => t.kind === "audio"); }
    addTrack(t: FakeTrack) { this.list.push(t); }
    removeTrack(t: FakeTrack) { this.list = this.list.filter((x) => x !== t); }
  };

  const FakeCtx = class {
    state = "running";
    createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
    createAnalyser() {
      return { fftSize: 1024, connect: () => {}, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) };
    }
    async close() {}
  };
  (global as Record<string, unknown>).AudioContext = FakeCtx;
  (window as unknown as Record<string, unknown>).AudioContext = FakeCtx;

  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
});

afterEach(() => { jest.useRealTimers(); });

async function flush(ms: number, steps = 20) {
  for (let i = 0; i < steps; i++) {
    await act(async () => {
      jest.advanceTimersByTime(Math.ceil(ms / steps));
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

/** Join as the invite-link guest and land in the running call. */
async function enterAsGuest() {
  render(<MeetingRoom roomCode={ROOM} />);
  const join = await screen.findByRole("button", { name: /join now/i });
  await act(async () => { join.click(); await Promise.resolve(); });
  await flush(400);
}

/** Somebody already in the room says hello, so a connection is built for them. */
async function peerJoins(id = "peer-1") {
  await act(async () => {
    realtime.signal({ type: "join", from: id, displayName: "Bea" });
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush(20, 3);
  return FakePC.all[FakePC.all.length - 1];
}

const relayOnly = (pc: FakePC) => pc.config.iceTransportPolicy === "relay";

const RELAY_CANDIDATE = {
  type: "relay",
  candidate: "candidate:3 1 udp 41820159 198.51.100.7 51234 typ relay raddr 203.0.113.9 rport 60001",
};
const HOST_CANDIDATE = {
  type: "host",
  candidate: "candidate:1 1 udp 2122260223 192.168.1.8 51234 typ host generation 0",
};

describe("a guest on a relay that works", () => {
  it("is put on the relay and left there", async () => {
    await enterAsGuest();
    const pc = await peerJoins();
    expect(relayOnly(pc)).toBe(true);

    // The allocation succeeded, which is the only thing that proves the relay is
    // real. Nothing should be rebuilt however long the call runs.
    await act(async () => { pc.offerCandidate(RELAY_CANDIDATE); await Promise.resolve(); });
    await act(async () => { pc.gather("gathering"); await Promise.resolve(); });
    await act(async () => { pc.gather("complete"); await Promise.resolve(); });
    await flush(RELAY_PROBE_MS * 3);

    expect(FakePC.all).toHaveLength(1);
    expect(pc.closed).toBe(false);
  });
});

describe("a guest on a relay that never allocates", () => {
  it("drops relay-only when gathering finishes with no relay candidate", async () => {
    await enterAsGuest();
    const first = await peerJoins();
    expect(relayOnly(first)).toBe(true);

    // Gathering that ENDS having produced nothing is the refused allocation: a
    // secret that no longer matches, a quota that is spent. This connection now
    // holds no candidates of any kind and never will.
    await act(async () => { first.gather("gathering"); await Promise.resolve(); });
    await act(async () => { first.gather("complete"); await Promise.resolve(); });
    await flush(100, 5);

    const rebuilt = FakePC.all[FakePC.all.length - 1];
    expect(rebuilt).not.toBe(first);
    expect(relayOnly(rebuilt)).toBe(false);
    // Widened, not emptied: the relay is still offered, it is simply no longer
    // the only thing allowed.
    expect(rebuilt.config.iceServers).toEqual(relayAnswer.iceServers);
    expect(first.closed).toBe(true);
  });

  it("drops relay-only on the deadline when gathering never finishes", async () => {
    await enterAsGuest();
    const first = await peerJoins();

    // A relay that neither answers nor refuses. Gathering can sit here for the
    // whole meeting, so completion is not something to wait for.
    await act(async () => { first.gather("gathering"); await Promise.resolve(); });
    await act(async () => { first.offerCandidate(HOST_CANDIDATE); await Promise.resolve(); });
    await flush(RELAY_PROBE_MS + 200, 10);

    const rebuilt = FakePC.all[FakePC.all.length - 1];
    expect(rebuilt).not.toBe(first);
    expect(relayOnly(rebuilt)).toBe(false);
  });

  it("waits out the deadline rather than giving up on the first quiet moment", async () => {
    await enterAsGuest();
    const first = await peerJoins();
    await act(async () => { first.gather("gathering"); await Promise.resolve(); });
    // Just short of it. A relay on a slow mobile link is allowed to be slow.
    await flush(RELAY_PROBE_MS - 400, 6);
    expect(FakePC.all).toHaveLength(1);
  });

  it("widens once, not once per peer", async () => {
    await enterAsGuest();
    const first = await peerJoins("peer-1");
    const second = await peerJoins("peer-2");
    expect(FakePC.all).toHaveLength(2);

    await act(async () => { first.gather("gathering"); await Promise.resolve(); });
    await act(async () => { first.gather("complete"); await Promise.resolve(); });
    await flush(100, 5);
    // Both unformed connections are rebuilt, and both on the widened policy.
    const rebuilt = FakePC.all.slice(2);
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt.every((pc) => !relayOnly(pc))).toBe(true);

    // The second connection's own gathering now reports the same emptiness. It
    // must not start another round: the policy has already been withdrawn, and a
    // rebuild per peer per event would churn the call forever.
    const before = FakePC.all.length;
    await act(async () => { second.gather("complete"); await Promise.resolve(); });
    await flush(RELAY_PROBE_MS + 200, 8);
    expect(FakePC.all).toHaveLength(before);
  });
});

describe("a guest whose relay allocates and still cannot carry the call", () => {
  it("widens when the relay-only connection fails", async () => {
    await enterAsGuest();
    const first = await peerJoins();
    await act(async () => { first.offerCandidate(RELAY_CANDIDATE); await Promise.resolve(); });

    await act(async () => { first.moveTo("failed"); await Promise.resolve(); });
    await flush(100, 5);

    const rebuilt = FakePC.all[FakePC.all.length - 1];
    expect(rebuilt).not.toBe(first);
    expect(relayOnly(rebuilt)).toBe(false);
  });

  it("offers ONCE on the replacement, and does not restart ICE on it", async () => {
    // The failed handler widens the policy and then recovers the peer. Widening
    // replaces the connection, so recovering it as well put a second offer on a
    // connection seconds old — two offers sharing one `makingOfferRef` flag,
    // either of which could clear it while the other was in flight — plus an ICE
    // restart on a connection that had never gathered a candidate.
    await enterAsGuest();
    const first = await peerJoins();
    await act(async () => { first.offerCandidate(RELAY_CANDIDATE); await Promise.resolve(); });

    await act(async () => { first.moveTo("failed"); await Promise.resolve(); });
    await flush(300, 8);

    const rebuilt = FakePC.all[FakePC.all.length - 1];
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.offers).toBe(1);
    expect(rebuilt.restarts).toBe(0);
  });

  it("still recovers a failed peer when nothing was replaced", async () => {
    // The guard must not swallow ordinary recovery. With relay-only already
    // withdrawn there is nothing to widen, so the failure is the recovery path's
    // and the connection it fails on is the one that gets restarted.
    relayAnswer = { iceServers: [{ urls: ["stun:stun.example.net:3478"] }], relay: false, reason: "unconfigured" };
    await enterAsGuest();
    const pc = await peerJoins();
    expect(relayOnly(pc)).toBe(false);
    const before = FakePC.all.length;

    await act(async () => { pc.moveTo("failed"); await Promise.resolve(); });
    await flush(300, 8);

    expect(FakePC.all).toHaveLength(before);
    expect(pc.restarts).toBeGreaterThanOrEqual(1);
  });

  it("leaves a peer the relay is already carrying alone", async () => {
    await enterAsGuest();
    const carried = await peerJoins("peer-1");
    const stalled = await peerJoins("peer-2");
    await act(async () => { carried.moveTo("connected"); await Promise.resolve(); });
    await flush(50, 3);
    const before = FakePC.all.length;

    // The other one's relay path fails. Widening is right for it, and tearing
    // down a call that is working to prove the point is not.
    await act(async () => { stalled.offerCandidate(RELAY_CANDIDATE); await Promise.resolve(); });
    await act(async () => { stalled.moveTo("failed"); await Promise.resolve(); });
    await flush(100, 5);

    expect(carried.closed).toBe(false);
    expect(FakePC.all.length).toBe(before + 1);
    expect(relayOnly(FakePC.all[FakePC.all.length - 1])).toBe(false);
  });
});

describe("a member, who was never put on the relay", () => {
  it("is left alone when gathering produces no relay candidate", async () => {
    // The deployment has no TURN at all, which is how `relay: false` reads. The
    // policy was never "relay", so there is nothing to withdraw — and rebuilding
    // here would drop working connections for every ordinary participant.
    relayAnswer = { iceServers: [{ urls: ["stun:stun.example.net:3478"] }], relay: false, reason: "unconfigured" };
    await enterAsGuest();
    const pc = await peerJoins();
    expect(relayOnly(pc)).toBe(false);

    await act(async () => { pc.gather("gathering"); await Promise.resolve(); });
    await act(async () => { pc.gather("complete"); await Promise.resolve(); });
    await act(async () => { pc.moveTo("failed"); await Promise.resolve(); });
    await flush(RELAY_PROBE_MS * 2, 10);

    // Only what the recovery path did: no rebuild from this file's code.
    expect(FakePC.all).toHaveLength(1);
  });
});

describe("a microphone repair still in flight when the connection is replaced", () => {
  it("does not leave the replacement's repair blocked for the rest of the call", async () => {
    // The in-flight flag stops two repairs racing on one sender. It was not
    // cleared when a peer's state was forgotten, so a repair still outstanding
    // when relay abandonment replaced the connection left the flag set for good —
    // and the replacement's microphone was never attached. The silent guest this
    // whole repair exists for, locked in by the guard meant to protect it.
    joinChoice.micEnabled = true;
    await enterAsGuest();
    const first = await peerJoins();
    await act(async () => { first.offerCandidate(RELAY_CANDIDATE); await Promise.resolve(); });

    // Connect, with the repair made to hang: the flag goes on and never comes off
    // by itself.
    hangReplaceTrack = true;
    await act(async () => { first.moveTo("connected"); await Promise.resolve(); });
    await flush(100, 4);
    hangReplaceTrack = false;

    // Now the relay path fails and the connection is replaced underneath it.
    await act(async () => { first.moveTo("failed"); await Promise.resolve(); });
    await flush(200, 6);
    const rebuilt = FakePC.all[FakePC.all.length - 1];
    expect(rebuilt).not.toBe(first);

    await act(async () => { rebuilt.moveTo("connected"); await Promise.resolve(); });
    await flush(200, 6);

    const attached = rebuilt.senders.flatMap((snd) => snd.replaced).filter(Boolean) as FakeTrack[];
    expect(attached.map((t) => t.kind)).toContain("audio");
  });
});

describe("the microphone a sender never picked up", () => {
  it("is re-attached when the connection comes up", async () => {
    // The fault that reads as "the host cannot hear the guest" with every state
    // on the connection saying healthy. Video had a repair for this and audio
    // had none, so a guest whose audio sender came up empty was silent for the
    // whole meeting and nothing anywhere said so.
    joinChoice.micEnabled = true;
    await enterAsGuest();
    const pc = await peerJoins();
    expect(pc.senders.length).toBeGreaterThanOrEqual(2);
    expect(pc.senders.every((s) => s.track === null)).toBe(true);

    await act(async () => { pc.moveTo("connected"); await Promise.resolve(); });
    await flush(200, 5);

    const attached = pc.senders.flatMap((s) => s.replaced).filter(Boolean) as FakeTrack[];
    expect(attached.map((t) => t.kind)).toContain("audio");
  });
});
