/**
 * The room once the call is actually running.
 *
 * Every other MeetingRoom test in this directory stops at the door. Their
 * reason, stated in MeetingRoom.exit.test.tsx and repeated in three more, is
 * that reaching the live call "means entering a room, a camera, an ICE
 * negotiation and a Realtime channel", so they render CallParts directly
 * instead. That left the live half of a 5,286-line component — the tile grid,
 * the speaker attribution, the sidebar's participant list — with no coverage of
 * how the ROOM wires them, only of the parts in isolation.
 *
 * It turns out the door opens. Everything the room reaches for on the way in is
 * a browser API, and jsdom lets all of them be stood in for: getUserMedia, a
 * peer connection, an AudioContext, a Realtime channel. So this file enters.
 *
 * The earlier objection is still right about one thing, and it decides what is
 * asserted here: a mocked ICE negotiation cannot tell you whether negotiation
 * works, so nothing here claims to. What a stub CANNOT fake is which React state
 * the room derives from a signal and which component it hands the answer to —
 * the fake supplies the input and the real code does all the deciding. So these
 * pin the wiring: that a `join` becomes a tile, that a `mic` announcement
 * reaches that tile, that the attribution puts the ring on the person actually
 * talking rather than on everybody, and that the second hand advances without
 * the room noticing. Every one of those was a plausible mistake with nothing
 * watching for it.
 *
 * The one thing measured here rather than asserted: what a speaking change
 * costs. `speaking` turns over about three times a second in conversation and
 * re-runs the room's whole body. The numbers are in the pull request, taken with
 * a Profiler through this same harness; a render count is not something an
 * assertion from outside the module can see.
 */
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams("guest=1&name=Ada"),
}));

/**
 * The green room owns the camera and the device pickers, which are its own
 * concern and tested in MeetingGreenRoom.devices.test.tsx. Here it is only the
 * press that starts the call, so it is one button — the same stand-in
 * MeetingRoom.admission.test.tsx uses, and joining with both devices off keeps
 * the media path to the minimum the room needs to go live.
 */
/**
 * What the stand-in green room hands over. Mutable so one test can join WANTING
 * the microphone, which is the only way to reach the case where the member
 * believes they are audible.
 */
const joinChoice = { cameraId: "", micId: "", speakerId: "", cameraEnabled: false, micEnabled: false, background: null as unknown };
jest.mock("./MeetingGreenRoom", () => ({
  MeetingGreenRoom: ({ onJoin }: { onJoin: (c: unknown) => void }) => (
    <button onClick={() => onJoin({ ...joinChoice })}>Join now</button>
  ),
}));

/** Everything the room broadcast about itself, newest last. */
const sent: unknown[] = [];

/** Lets a test put a message on the room's signalling channel. */
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
      // Recorded, not discarded: what the room SAYS about itself is the subject
      // of the participation tests below, where announcing the wrong thing was
      // the whole defect.
      send: async (m: unknown) => { sent.push(m); return "ok"; },
      unsubscribe: async () => "ok",
    };
    return api;
  },
  removeChannel: (c: { removed: boolean }) => { if (c) c.removed = true; },
};
jest.mock("@/lib/supabase/client", () => ({ createClient: () => supabaseStub }));

import { MeetingRoom } from "./MeetingRoom";

const ROOM = "abc-defg-hi";

/** Peer connections the room built, so a test can deliver a track over one. */
const pcs: Record<string, unknown>[] = [];
/** Audio track ids in join order, which is how a test says who is talking. */
const peerAudioIds: string[] = [];
/** Whose analyser reports a voice. Empty means the room is silent. */
let speakerNow = "";
let lastTapTrackId = "";

function fakeTrack(kind: string, id = `${kind}-local`) {
  return {
    kind, id, enabled: true, readyState: "live",
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

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.clearAllMocks();
  realtime.reset();
  sent.length = 0;
  joinChoice.cameraEnabled = false;
  joinChoice.micEnabled = false;
  pcs.length = 0;
  peerAudioIds.length = 0;
  speakerNow = "";
  lastTapTrackId = "";
  window.localStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const reply = (status: number, body: unknown) => ({
      ok: status >= 200 && status <= 299, status, headers: new Headers(), json: async () => body,
    }) as Response;
    // Admitted at once: the waiting-room verdicts are
    // MeetingRoom.admission.test.tsx's subject, not this file's.
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

  /**
   * Enough RTCPeerConnection to be built and handed a track.
   *
   * It negotiates nothing, which is why nothing here asserts about negotiation.
   * It records itself so a test can fire `ontrack`, which is the only part of
   * the interface the room's rendering actually depends on.
   */
  class FakePC {
    connectionState = "connected";
    iceConnectionState = "connected";
    signalingState = "stable";
    localDescription = null;
    remoteDescription = null;
    ontrack: unknown = null;
    onicecandidate: unknown = null;
    onconnectionstatechange: unknown = null;
    oniceconnectionstatechange: unknown = null;
    onnegotiationneeded: unknown = null;
    constructor() { pcs.push(this as unknown as Record<string, unknown>); }
    addTrack() { return { replaceTrack: async () => {}, setParameters: async () => {}, getParameters: () => ({ encodings: [{}] }), track: null }; }
    addTransceiver() { return { sender: { replaceTrack: async () => {}, setParameters: async () => {}, getParameters: () => ({ encodings: [{}] }) }, receiver: {} }; }
    getSenders() { return []; }
    getReceivers() { return []; }
    getTransceivers() { return []; }
    async createOffer() { return { type: "offer", sdp: "v=0" }; }
    async createAnswer() { return { type: "answer", sdp: "v=0" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    async addIceCandidate() {}
    async getStats() { return new Map(); }
    restartIce() {}
    close() { this.connectionState = "closed"; }
  }
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

  /**
   * An AudioContext whose analysers answer per person.
   *
   * Each analyser is bound to the track of the tap it was created for, so the
   * test can hand the floor to one participant and the room's REAL attribution
   * decides what that means. One shared level for everybody was the first
   * version of this and it was worse than useless: it made every tile's
   * `speaking` flip on the same tick, so the memo that exists to stop exactly
   * that never got a chance to bail out, and measurement through it said
   * memoising the tile was pointless. A fixture in which nobody takes turns
   * cannot see the cost of everybody re-rendering at once.
   */
  const FakeCtx = class {
    state = "running";
    createMediaStreamSource(ms: { getAudioTracks: () => { id: string }[] }) {
      lastTapTrackId = ms.getAudioTracks()[0]?.id ?? "";
      return { connect: () => {}, disconnect: () => {} };
    }
    createAnalyser() {
      const mine = lastTapTrackId;
      return {
        fftSize: 1024,
        connect: () => {},
        getFloatTimeDomainData: (buf: Float32Array) => {
          const v = mine && mine === speakerNow ? 0.5 : 0;
          for (let i = 0; i < buf.length; i++) buf[i] = v;
        },
      };
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

/** Advance the fake clock while letting the join's promise chains drain. */
async function flush(ms: number, steps = 20) {
  for (let i = 0; i < steps; i++) {
    await act(async () => {
      jest.advanceTimersByTime(Math.ceil(ms / steps));
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

/** Join, get admitted, and land in the running call. */
async function enterCall() {
  const view = render(<MeetingRoom roomCode={ROOM} />);
  const join = await screen.findByRole("button", { name: /join now/i });
  // The admission verdict resolves off a promise chain the click starts, so the
  // press and its settling belong in the same act() — otherwise React warns
  // about the state update that lands between them.
  await act(async () => {
    join.click();
    await Promise.resolve();
  });
  await flush(400);
  return view;
}

/** Someone arrives and their camera and microphone start flowing. */
async function peerArrives(id: string, displayName: string) {
  const before = pcs.length;
  await act(async () => {
    realtime.signal({ type: "join", from: id, displayName });
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush(20, 3);

  const pc = pcs[before] ?? pcs[pcs.length - 1];
  const audio = fakeTrack("audio", `audio-${id}`);
  peerAudioIds.push(audio.id);
  await act(async () => {
    const fire = pc?.ontrack as ((ev: unknown) => void) | null;
    const MS = (global as unknown as { MediaStream: new (t: FakeTrack[]) => unknown }).MediaStream;
    if (typeof fire === "function") {
      fire({ track: fakeTrack("video", `video-${id}`), streams: [new MS([fakeTrack("video", `video-${id}`), audio])] });
    }
    await Promise.resolve();
  });
  await flush(20, 3);
  return audio.id;
}

/** Run the voice meter for a while with one person holding the floor. */
async function talkFor(ms: number, audioTrackId: string) {
  speakerNow = audioTrackId;
  const ticks = Math.ceil(ms / 120);
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      jest.advanceTimersByTime(120);
      await Promise.resolve();
    });
  }
}

/** The tile captions, which carry each person's name. */
function tileLabels() {
  return Array.from(document.querySelectorAll("video"))
    .map((v) => v.parentElement?.textContent ?? "")
    .join(" | ");
}

describe("the tile grid", () => {
  it("puts the local tile on the stage as soon as the call is running", async () => {
    await enterCall();
    expect(document.querySelectorAll("video").length).toBe(1);
    expect(tileLabels()).toContain("Ada (You)");
  });

  it("gives an arriving peer a tile of their own, under their own name", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");

    expect(document.querySelectorAll("video").length).toBe(2);
    expect(tileLabels()).toContain("Brett");
    expect(tileLabels()).toContain("Ada (You)");
  });

  it("keeps two arrivals apart rather than collapsing them into one tile", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");
    await peerArrives("peer-2", "Carla");

    expect(document.querySelectorAll("video").length).toBe(3);
    expect(tileLabels()).toContain("Brett");
    expect(tileLabels()).toContain("Carla");
  });
});

describe("where the call's sound comes from", () => {
  // Echo: a voice played twice, or played by an element that moves with the
  // layout, comes out of the speakers a beat apart and goes back into the mic.

  it("never plays sound from a tile — every <video> is muted, the local one included", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");
    await peerArrives("peer-2", "Carla");

    const videos = Array.from(document.querySelectorAll("video"));
    expect(videos.length).toBe(3);
    for (const v of videos) expect(v.muted).toBe(true);
  });

  it("plays each peer's voice from exactly one element, and none for the member themselves", async () => {
    await enterCall();
    expect(document.querySelectorAll("audio[data-peer-audio]").length).toBe(0);

    await peerArrives("peer-1", "Brett");
    await peerArrives("peer-2", "Carla");

    const audios = Array.from(document.querySelectorAll<HTMLAudioElement>("audio[data-peer-audio]"));
    expect(audios.length).toBe(2);
    for (const a of audios) expect(a.muted).toBe(false);
    // Two different people, two different streams: nobody is played twice.
    expect(new Set(audios.map((a) => a.srcObject)).size).toBe(2);
  });

  it("transcribes from the call's echo-cancelled mic track, not a second raw capture", async () => {
    const starts: unknown[][] = [];
    class FakeRecognition {
      continuous = false; interimResults = false; lang = "";
      onstart: (() => void) | null = null; onresult = null; onerror = null; onend = null; onspeechstart = null;
      start(...args: unknown[]) { starts.push(args); }
      stop() {}
    }
    const w = window as unknown as { SpeechRecognition?: unknown };
    const previous = w.SpeechRecognition;
    w.SpeechRecognition = FakeRecognition;
    try {
      await enterCall();
      await flush(20, 3);
      expect(starts.length).toBeGreaterThan(0);
      const [track] = starts[0] as [{ kind?: string } | undefined];
      expect(track?.kind).toBe("audio");
    } finally {
      w.SpeechRecognition = previous;
    }
  });
});

describe("what a peer announces about themselves", () => {
  // Mic state is announced, never inferred: a newcomer is assumed unmuted until
  // they say otherwise, so the announcement is the only thing that can put the
  // muted marker on their tile.
  it("shows a peer as muted once they say they are", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");
    expect(screen.queryAllByLabelText("Muted").length).toBe(1); // the local tile

    await act(async () => {
      realtime.signal({ type: "mic", from: "peer-1", micOn: false, displayName: "Brett" });
      await Promise.resolve();
    });
    await flush(20, 3);

    expect(screen.queryAllByLabelText("Muted").length).toBe(2);
  });
});

describe("who the room thinks is talking", () => {
  /**
   * The ring is the point of the attribution, and the thing worth pinning is
   * that it lands on ONE person. Every tile reading the same level would look
   * right in a screenshot of a room where one person talks, and wrong in every
   * other frame.
   */
  it("rings the speaker's tile and nobody else's", async () => {
    await enterCall();
    const brett = await peerArrives("peer-1", "Brett");
    await peerArrives("peer-2", "Carla");

    const pulsing = () =>
      Array.from(document.querySelectorAll("span.animate-pulse"))
        .map((s) => s.parentElement?.textContent ?? "")
        .filter((t) => t.length > 0);

    await talkFor(1200, brett);

    const lit = pulsing();
    expect(lit.some((t) => t.includes("Brett"))).toBe(true);
    expect(lit.some((t) => t.includes("Carla"))).toBe(false);
  });

  /**
   * And lets go of it again — but not for about three seconds, which is longer
   * than the 900ms hold alone and is worth writing down. `smoothLevel` decays
   * the level rather than dropping it, so after a voice stops the smoothed value
   * spends roughly two seconds falling to the 0.08 threshold, and only then does
   * the hold start. Asserting at exactly 3000ms sat on that boundary and was
   * flaky by construction; the margin here is deliberate, and the number it is
   * really pinning is "a few seconds, not forever".
   */
  it("lets go of the ring once that person stops talking", async () => {
    await enterCall();
    const brett = await peerArrives("peer-1", "Brett");

    await talkFor(1200, brett);
    expect(document.querySelectorAll("span.animate-pulse").length).toBeGreaterThan(0);

    await talkFor(5000, "");
    expect(document.querySelectorAll("span.animate-pulse").length).toBe(0);
  });
});

describe("the side panel the room feeds", () => {
  // It used to open with the call: a column of empty chat beside the faces,
  // and on a phone a sheet over the whole stage.
  it("starts closed, with the call on the whole stage", async () => {
    await enterCall();
    expect(screen.queryByRole("button", { name: "Close panel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "false");
  });

  it("lists everyone in the call on the People tab", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");
    await peerArrives("peer-2", "Carla");

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /^People/ }));

    const list = screen.getByText(/In this call/i).parentElement;
    expect(list?.textContent).toContain("Brett");
    expect(list?.textContent).toContain("Carla");
    expect(list?.textContent).toContain("Ada");
  });
});

describe("the second hand", () => {
  /**
   * The clock is a leaf with its own interval, reading a ref the room owns, so
   * that a running meeting does not re-render every face in it once a second
   * (see MeetingClock's own note). This pins the half of that a test can reach:
   * that the time on screen still advances. Hand the clock a value instead of a
   * ref and it freezes; the room going quiet is the part measured in the pull
   * request rather than asserted here.
   */
  it("advances while the room around it holds still", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");
    const tilesBefore = document.querySelectorAll("video").length;

    await waitFor(() => expect(document.body.textContent).toMatch(/00:0\d/));
    await talkFor(4000, "");

    expect(document.body.textContent).toMatch(/00:0[3-9]/);
    expect(document.querySelectorAll("video").length).toBe(tilesBefore);
  });
});

describe("a member with no microphone", () => {
  /**
   * The defect, end to end.
   *
   * A guest denies the permission prompt and joins. They have no audio track at
   * all, but the control was captioned "Unmute" and pressing it set
   * `enabled = true` on an empty list, flipped the button to on, cleared the
   * watcher that was trying to get the device back, and broadcast `micOn: true`.
   * So they believed they were speaking, the host had been told they were
   * speaking, and the meeting waited for somebody who could not speak to it.
   *
   * Nothing in jsdom can prove a microphone works. What it can prove is the
   * part that was wrong: what the room claims, to the member and to the room.
   */
  beforeEach(() => {
    // Both wanted. The camera arrives and the microphone does not, so the
    // notice is about the one device that is actually missing.
    joinChoice.micEnabled = true;
    joinChoice.cameraEnabled = true;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        // A camera, and no microphone — the shape a denied mic prompt leaves.
        getUserMedia: async () => fakeStream([fakeTrack("video")]),
        getDisplayMedia: async () => fakeStream([fakeTrack("video")]),
        enumerateDevices: async () => [],
        addEventListener: () => {}, removeEventListener: () => {},
      },
    });
  });

  /**
   * The microphone control, by the captions it is allowed to have.
   *
   * Queried over buttons only: the local tile carries a "Muted — not being
   * transcribed" badge with a title of its own, and a looser selector matches
   * both.
   */
  const micButton = () => {
    const el = document.querySelector<HTMLButtonElement>(
      'button[title="No microphone — retry"], button[title="Mute"], button[title="Unmute"]',
    );
    if (!el) throw new Error("no microphone control on screen");
    return el;
  };

  it("says so, instead of offering to unmute a microphone that is not there", async () => {
    await enterCall();
    expect(micButton().getAttribute("title")).toBe("No microphone — retry");
  });

  it("tells the member nobody can hear them, with something to press", async () => {
    await enterCall();
    expect(screen.getByText(/Nobody can hear you/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("never announces itself as unmuted when there is no microphone", async () => {
    await enterCall();
    await act(async () => { micButton().click(); await Promise.resolve(); });
    await flush(10, 2);

    // The assertion the bug turned on. A `mic` announcement with `micOn: true`
    // is the room telling everybody else to expect this member's voice.
    const claims = sent.filter((m) => {
      const payload = (m as { payload?: { type?: string; micOn?: boolean } }).payload;
      return payload?.type === "mic" && payload.micOn === true;
    });
    expect(claims).toEqual([]);
  });

  it("does not flip the control to on when the press cannot deliver", async () => {
    await enterCall();
    await act(async () => { micButton().click(); await Promise.resolve(); });
    await flush(10, 2);
    // Still the honest caption, and still the banner: the press asked for the
    // device and the device is still not there.
    expect(micButton().getAttribute("title")).toBe("No microphone — retry");
    expect(screen.getByText(/Nobody can hear you/)).toBeInTheDocument();
  });

  it("goes and asks for the device when the member presses the control", async () => {
    await enterCall();
    const asked = jest.spyOn(navigator.mediaDevices, "getUserMedia");
    await act(async () => { micButton().click(); await Promise.resolve(); });
    await flush(10, 2);
    // The press means "try to get my microphone back" now, which is what the
    // camera's own toggle has always done and the microphone's never did.
    expect(asked).toHaveBeenCalled();
  });

  it("stops saying it once a microphone actually arrives", async () => {
    await enterCall();
    expect(screen.getByText(/Nobody can hear you/)).toBeInTheDocument();

    // The retry succeeds this time.
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream([fakeTrack("audio"), fakeTrack("video")]),
        getDisplayMedia: async () => fakeStream([fakeTrack("video")]),
        enumerateDevices: async () => [],
        addEventListener: () => {}, removeEventListener: () => {},
      },
    });
    await act(async () => { screen.getByRole("button", { name: "Retry" }).click(); await Promise.resolve(); });
    await flush(20, 3);

    // Derived, not stored: nothing had to remember to clear this.
    await waitFor(() => expect(screen.queryByText(/Nobody can hear you/)).not.toBeInTheDocument());
    expect(micButton().getAttribute("title")).not.toBe("No microphone — retry");
  });
});

describe("a member who simply muted themselves", () => {
  it("is not nagged about a microphone they have", async () => {
    // The other half of the rule. Joining muted is the ordinary thing, and a
    // banner here would follow every member of every meeting who did it.
    joinChoice.micEnabled = false;
    await enterCall();
    expect(screen.queryByText(/Nobody can hear you/)).not.toBeInTheDocument();
    // The ordinary caption, on a control that can deliver what it says.
    expect(document.querySelector('button[title="Unmute"]')).not.toBeNull();
  });
});
