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
import { REANNOUNCE_CADENCE_MS, REANNOUNCE_STEPS_MS } from "@/lib/meetings/connection";

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
    const langs: string[] = [];
    class FakeRecognition {
      continuous = false; interimResults = false; lang = "";
      onstart: (() => void) | null = null; onresult = null; onerror = null; onend = null; onspeechstart = null;
      start(...args: unknown[]) { starts.push(args); langs.push(this.lang); }
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
      // And in the browser's language, not en-US for everyone.
      expect(langs).toEqual([navigator.language]);
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

  // With no track to start on, the recogniser used to fall through to a bare
  // `start()`: a raw capture of whatever the OS default input is -- on a Mac
  // with an iPhone nearby, the phone -- transcribed under this member's name
  // while the call itself had no microphone. Now it waits for one.
  it("does not transcribe from a raw capture of the default device", async () => {
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
      expect(starts).toEqual([]);
    } finally {
      w.SpeechRecognition = previous;
    }
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

  // A mute_all arriving while this member's microphone is still being looked
  // for must also update the standing intent, because reacquireMic applies the
  // intent to whatever device it recovers. Without that, the automatic
  // recovery read the intent recorded at join and announced micOn: true a few
  // seconds after the room had been told everyone was muted.
  it("keeps a mute_all in force when the microphone is recovered later", async () => {
    await enterCall();
    expect(screen.getByText(/Nobody can hear you/)).toBeInTheDocument();

    await act(async () => {
      realtime.signal({ type: "mute_all", from: "peer-1" });
      await Promise.resolve();
    });

    // The device comes back, and the automatic watcher (not a press) finds it.
    const recovered = fakeTrack("audio");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream([recovered]),
        getDisplayMedia: async () => fakeStream([fakeTrack("video")]),
        enumerateDevices: async () => [],
        addEventListener: () => {}, removeEventListener: () => {},
      },
    });
    // Past the watcher's first few delays, so the recovery has happened.
    await flush(10_000, 10);
    await waitFor(() => expect(screen.queryByText(/Nobody can hear you/)).not.toBeInTheDocument());

    // The recovered track is attached but held back, and nothing announced
    // this member as audible after the mute.
    expect(recovered.enabled).toBe(false);
    const claims = sent.filter((m) => {
      const payload = (m as { payload?: { type?: string; micOn?: boolean } }).payload;
      return payload?.type === "mic" && payload.micOn === true;
    });
    expect(claims).toEqual([]);
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

describe("an engine that reports only the ICE state", () => {
  // `pc.connectionState` is not universal. The ICE fallback handler claimed to
  // funnel into the same work as `onconnectionstatechange` and funnelled into
  // almost none of it: on these engines a connection that reached `connected`
  // skipped the sender repairs, the send caps, the video-state announcement
  // and the inbound audit — the machinery that notices a newcomer whose
  // connection is up and carrying nothing.
  it("runs the connected-time work from the ICE state alone", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");

    const pc = pcs[0] as Record<string, unknown>;
    pc.connectionState = undefined;
    pc.iceConnectionState = "connected";
    sent.length = 0;

    await act(async () => {
      (pc.oniceconnectionstatechange as () => void)();
      await Promise.resolve();
    });
    await flush(20, 3);

    // The video-state announcement is the observable half of that work: it is
    // sent on every connect so the far end knows what to expect from us.
    const announced = sent.filter(
      (m) => (m as { payload?: { type?: string } }).payload?.type === "video",
    );
    expect(announced.length).toBeGreaterThan(0);
  });
});

/**
 * The failure this covers is the one a host reports as "I admitted them and I
 * can't see or hear them".
 *
 * `join` is the only message in the room's protocol that makes anybody build a
 * peer connection to the sender — an offer answers a join, an answer answers an
 * offer, an ICE candidate belongs to a connection that already exists. It went
 * out once, fire and forget, over a socket milliseconds old, and its delivery
 * result was thrown away. When it did not arrive the member was in the meeting
 * with their devices open and their own room drawn correctly, and invisible to
 * everybody, for the rest of the call.
 *
 * This harness is a guest (`guest=1&name=Ada` above), which is the participant
 * who hit it: theirs is the last hello sent, and the one sent from somebody
 * else's network straight out of the waiting room.
 */
describe("a hello that nobody answered", () => {
  const joinsSent = () =>
    sent.filter((m) => (m as { payload?: { type?: string } }).payload?.type === "join").length;

  it("says it again rather than leaving the member invisible for the whole call", async () => {
    await enterCall();
    const opening = joinsSent();
    expect(opening).toBeGreaterThan(0);

    // Nobody offered back, so this client holds no peer connection at all. From
    // inside the room that is indistinguishable from an empty meeting, and only
    // one of the two is a failure — so it speaks up again.
    await flush(REANNOUNCE_STEPS_MS[0] + 500, 8);
    expect(joinsSent()).toBeGreaterThan(opening);
  });

  it("keeps saying it for as long as the silence lasts", async () => {
    await enterCall();
    const opening = joinsSent();

    const everyStep = REANNOUNCE_STEPS_MS.reduce((a, b) => a + b, 0);
    await flush(everyStep + REANNOUNCE_CADENCE_MS + 2_000, 70);

    // Asserted as a floor, not a count: pinning the exact number would pin the
    // schedule. What matters is that it did not give up after one attempt,
    // which is what the old code did — and what left the only cure a reload
    // nothing asked for.
    expect(joinsSent()).toBeGreaterThanOrEqual(opening + REANNOUNCE_STEPS_MS.length);
  });

  it("stops the moment somebody answers", async () => {
    await enterCall();
    await peerArrives("peer-1", "Brett");
    const settled = joinsSent();

    await flush(REANNOUNCE_CADENCE_MS * 2, 40);
    // A `join` tears down every peer connection in the room and rebuilds it, so
    // repeating it at somebody already here would be the cure causing the
    // disease. Silence once answered is as load-bearing as speech before.
    expect(joinsSent()).toBe(settled);
  });
});

describe("a recogniser deaf to the call's microphone", () => {
  /**
   * The host this is for: an external mic or conference device carries the
   * call, and the browser's speech engine ignored `start(track)` and is
   * capturing the computer's DEFAULT microphone instead — a different, often
   * silent device. The call, the meter and every peer hear the real mic, so
   * nothing else on screen says why the transcript is empty or wrong.
   */
  function installDeafRecognition() {
    const instances: Array<{
      onstart: (() => void) | null;
      onresult: ((ev: unknown) => void) | null;
    }> = [];
    class DeafRecognition {
      continuous = false; interimResults = false; lang = "";
      onstart: (() => void) | null = null;
      onresult: ((ev: unknown) => void) | null = null;
      onerror = null; onend = null; onspeechstart = null;
      constructor() { instances.push(this); }
      start() { this.onstart?.(); }
      stop() {}
    }
    const w = window as unknown as { SpeechRecognition?: unknown };
    const previous = w.SpeechRecognition;
    w.SpeechRecognition = DeafRecognition;
    return { instances, restore: () => { w.SpeechRecognition = previous; } };
  }

  const notice = () => screen.queryByText(/Transcription can.t hear you/);

  it("says so after seconds of audible speech the engine never answered, and stands down when it does", async () => {
    joinChoice.micEnabled = true;
    const sr = installDeafRecognition();
    try {
      await enterCall();
      expect(sr.instances.length).toBeGreaterThan(0);

      // The member talks on the call's own microphone; the engine says nothing.
      await talkFor(14_000, "audio-local");
      expect(notice()).toBeInTheDocument();

      // Anything back from the engine — even an empty event — is proof it
      // hears the microphone, and the notice withdraws itself.
      await act(async () => {
        sr.instances[0].onresult?.({ resultIndex: 0, results: [] });
        await Promise.resolve();
      });
      expect(notice()).not.toBeInTheDocument();
    } finally { sr.restore(); }
  });

  it("stays quiet for an engine that keeps answering", async () => {
    joinChoice.micEnabled = true;
    const sr = installDeafRecognition();
    try {
      await enterCall();
      for (let i = 0; i < 5; i++) {
        await talkFor(3_000, "audio-local");
        await act(async () => {
          sr.instances[0].onresult?.({ resultIndex: 0, results: [] });
          await Promise.resolve();
        });
      }
      expect(notice()).not.toBeInTheDocument();
    } finally { sr.restore(); }
  });
});

describe("the chosen speaker disappearing", () => {
  /**
   * Unplugging the chosen output — or a Bluetooth headset dropping — moves
   * call audio nowhere: every element keeps the dead sinkId and renders
   * silence, which to this member is a call where everybody suddenly stopped
   * talking at once. The room must notice, route back to the system default,
   * and say what happened.
   */
  it("routes call audio back to the default output and says so", async () => {
    // jsdom has no setSinkId; stand up the slice the routing uses.
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: async function (this: HTMLMediaElement & { sinkId?: string }, id: string) {
        this.sinkId = id;
      },
    });
    const deviceChange: Array<() => void> = [];
    let machine = [
      { kind: "audiooutput", deviceId: "headset-1", label: "Headset", groupId: "g1" },
      { kind: "audiooutput", deviceId: "default", label: "Default", groupId: "g2" },
    ];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream([fakeTrack("audio"), fakeTrack("video")]),
        getDisplayMedia: async () => fakeStream([fakeTrack("video")]),
        enumerateDevices: async () => machine,
        addEventListener: (type: string, fn: () => void) => { if (type === "devicechange") deviceChange.push(fn); },
        removeEventListener: () => {},
      },
    });
    joinChoice.speakerId = "headset-1";

    try {
      await enterCall();
      await peerArrives("peer-1", "Brett");

      // The join routed the peer's voice to the chosen headset.
      const voice = () => document.querySelector<HTMLAudioElement & { sinkId?: string }>("audio[data-peer-audio]")!;
      expect(voice().sinkId).toBe("headset-1");

      // The headset goes away.
      machine = machine.filter((d) => d.deviceId !== "headset-1");
      await act(async () => {
        deviceChange.forEach((fn) => fn());
        await Promise.resolve();
        await Promise.resolve();
      });
      await flush(60, 6);

      // The voice is back on a speaker that exists, and the member was told.
      expect(voice().sinkId).toBe("");
      expect(screen.getByText(/speaker was disconnected/i)).toBeInTheDocument();
    } finally {
      joinChoice.speakerId = "";
      delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    }
  });

  it("does nothing while the chosen speaker is still there", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: async function (this: HTMLMediaElement & { sinkId?: string }, id: string) {
        this.sinkId = id;
      },
    });
    const deviceChange: Array<() => void> = [];
    const machine = [
      { kind: "audiooutput", deviceId: "headset-1", label: "Headset", groupId: "g1" },
      { kind: "audioinput", deviceId: "mic-1", label: "Mic", groupId: "g1" },
    ];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream([fakeTrack("audio"), fakeTrack("video")]),
        getDisplayMedia: async () => fakeStream([fakeTrack("video")]),
        enumerateDevices: async () => machine,
        addEventListener: (type: string, fn: () => void) => { if (type === "devicechange") deviceChange.push(fn); },
        removeEventListener: () => {},
      },
    });
    joinChoice.speakerId = "headset-1";

    try {
      await enterCall();
      await peerArrives("peer-1", "Brett");
      const voice = document.querySelector<HTMLAudioElement & { sinkId?: string }>("audio[data-peer-audio]")!;
      expect(voice.sinkId).toBe("headset-1");

      // A devicechange that is about something else — a mic unplugged.
      await act(async () => {
        deviceChange.forEach((fn) => fn());
        await Promise.resolve();
        await Promise.resolve();
      });
      await flush(60, 6);

      expect(voice.sinkId).toBe("headset-1");
      expect(screen.queryByText(/speaker was disconnected/i)).not.toBeInTheDocument();
    } finally {
      joinChoice.speakerId = "";
      delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    }
  });
});

describe("a camera that stalls without ending", () => {
  /**
   * The third camera failure, beside never starting and ending: Windows hands
   * the device to another application, or a privacy shutter closes. The track
   * stays `live` and fires `mute`, the encoder keeps the last frame, and every
   * tile in the room freezes on it — including the member's own, so nothing
   * told them the room was frozen too.
   */
  function eventedTrack(kind: string, id: string) {
    const listeners = new Map<string, Set<() => void>>();
    const track = {
      kind, id, enabled: true, readyState: "live", muted: false,
      getSettings: () => ({ deviceId: `${kind}-dev` }),
      addEventListener(type: string, fn: () => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: () => void) { listeners.get(type)?.delete(fn); },
      fire(type: string) { [...(listeners.get(type) ?? [])].forEach((fn) => fn()); },
      stop: () => {}, applyConstraints: async () => {},
      clone() { return this; },
    };
    return track;
  }

  function withEventedCamera() {
    const camera = eventedTrack("video", "video-local");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => fakeStream([fakeTrack("audio"), camera as unknown as FakeTrack]),
        getDisplayMedia: async () => fakeStream([fakeTrack("video")]),
        enumerateDevices: async () => [],
        addEventListener: () => {}, removeEventListener: () => {},
      },
    });
    return camera;
  }

  const notice = () => screen.queryByText(/stopped sending video/i);

  it("tells the member after frames stop for a sustained stretch, and stands down when they resume", async () => {
    joinChoice.cameraEnabled = true;
    const camera = withEventedCamera();
    await enterCall();

    // The device wedges: still live, no longer producing.
    camera.muted = true;
    await act(async () => { camera.fire("mute"); await Promise.resolve(); });
    await flush(5_000, 10);
    expect(notice()).toBeInTheDocument();

    // Frames resume — the other app let go, the shutter opened.
    camera.muted = false;
    await act(async () => { camera.fire("unmute"); await Promise.resolve(); });
    expect(notice()).not.toBeInTheDocument();
  });

  it("says nothing about a blip that resolves itself", async () => {
    joinChoice.cameraEnabled = true;
    const camera = withEventedCamera();
    await enterCall();

    camera.muted = true;
    await act(async () => { camera.fire("mute"); await Promise.resolve(); });
    await flush(1_000, 4);
    camera.muted = false;
    await act(async () => { camera.fire("unmute"); await Promise.resolve(); });
    await flush(5_000, 10);

    expect(notice()).not.toBeInTheDocument();
  });
});

describe("a participant whose browser cannot transcribe", () => {
  // The ownership rule means their words reach no transcript anywhere, and
  // until the room was told, nobody — least of all the host reading the
  // report — had any way to know. See transcription-coverage.ts.
  const notice = () => screen.queryByText(/being transcribed/);

  async function peerReports(id: string, transcribing: boolean, displayName?: string) {
    await act(async () => {
      realtime.signal({ type: "sr", from: id, transcribing, displayName });
      await Promise.resolve();
    });
  }

  it("names them to the room, and withdraws when their transcription recovers", async () => {
    await enterCall();
    await peerArrives("peer-1", "Maya");

    await peerReports("peer-1", false, "Maya");
    expect(notice()).toBeInTheDocument();
    expect(notice()!.textContent).toContain("Maya isn't being transcribed");
    expect(notice()!.textContent).toContain("not reaching the transcript or the report");

    await peerReports("peer-1", true, "Maya");
    expect(notice()).not.toBeInTheDocument();
  });

  it("stays dismissed for the problem it was dismissed for, and returns for a new one", async () => {
    await enterCall();
    await peerArrives("peer-1", "Maya");
    await peerArrives("peer-2", "Li");

    await peerReports("peer-1", false, "Maya");
    await act(async () => {
      screen.getByRole("button", { name: /dismiss/i }).click();
      await Promise.resolve();
    });
    expect(notice()).not.toBeInTheDocument();

    // The same fact repeated must not re-open it…
    await peerReports("peer-1", false, "Maya");
    expect(notice()).not.toBeInTheDocument();

    // …but a second person losing coverage is new information.
    await peerReports("peer-2", false, "Li");
    expect(notice()).toBeInTheDocument();
    expect(notice()!.textContent).toContain("Maya and Li aren't being transcribed");
  });

  it("tells the room about its own coverage, which in this browser is none", async () => {
    // jsdom has no SpeechRecognition — exactly the Firefox case. The announce
    // effect must have said so, or every peer would file this member's silence
    // in the transcript as a person with nothing to say.
    await enterCall();
    const srClaims = sent
      .map((m) => (m as { payload?: { type?: string; transcribing?: boolean } }).payload)
      .filter((p) => p?.type === "sr");
    expect(srClaims.length).toBeGreaterThan(0);
    expect(srClaims[srClaims.length - 1]!.transcribing).toBe(false);
  });

  it("repeats its coverage to a newcomer, the way mic state is repeated", async () => {
    await enterCall();
    sent.length = 0;
    await peerArrives("peer-1", "Maya");
    const srClaims = sent
      .map((m) => (m as { payload?: { type?: string } }).payload)
      .filter((p) => p?.type === "sr");
    expect(srClaims.length).toBeGreaterThan(0);
  });
});

describe("the last sentence before a mute", () => {
  /**
   * The engine finalizes a sentence a second or two AFTER it ends, and "say
   * your piece, hit mute" lands the click exactly in that gap. Judged by the
   * mic's state at delivery, the member's final sentence of every topic they
   * closed with a mute was dropped as "heard while you were muted" — spoken on
   * a live microphone and in nobody's transcript.
   */
  function installSpeakingRecognition() {
    const instances: Array<{
      onstart: (() => void) | null;
      onspeechstart: (() => void) | null;
      onresult: ((ev: unknown) => void) | null;
    }> = [];
    class SpeakingRecognition {
      continuous = false; interimResults = false; lang = "";
      onstart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onresult: ((ev: unknown) => void) | null = null;
      onerror = null; onend = null;
      constructor() { instances.push(this); }
      start() { this.onstart?.(); }
      stop() {}
    }
    const w = window as unknown as { SpeechRecognition?: unknown };
    const previous = w.SpeechRecognition;
    w.SpeechRecognition = SpeakingRecognition;
    return { instances, restore: () => { w.SpeechRecognition = previous; } };
  }

  /** One settled engine result, in the Web Speech API's array-of-arrays shape. */
  const finalResult = (text: string) => ({
    resultIndex: 0,
    results: [Object.assign([{ transcript: text, confidence: 0.92 }], { isFinal: true })],
  });

  const broadcastLines = () =>
    sent
      .map((m) => (m as { payload?: { type?: string; text?: string } }).payload)
      .filter((p) => p?.type === "transcript")
      .map((p) => p!.text);

  it("keeps words spoken on a live mic even when the final lands after the mute", async () => {
    joinChoice.micEnabled = true;
    const sr = installSpeakingRecognition();
    try {
      await enterCall();

      // The member talks, audibly, with the mic on…
      await act(async () => { sr.instances[0]?.onspeechstart?.(); await Promise.resolve(); });
      await talkFor(2_000, "audio-local");

      // …mutes the moment they finish…
      const mute = document.querySelector('button[title="Mute"]') as HTMLButtonElement;
      expect(mute).not.toBeNull();
      await act(async () => { mute.click(); await Promise.resolve(); });

      // …and only then does the engine hand the sentence over.
      await act(async () => {
        sr.instances[0]?.onresult?.(finalResult("let's wire on Friday"));
        await Promise.resolve();
      });

      expect(broadcastLines()).toContain("let's wire on Friday");
    } finally {
      sr.restore();
    }
  });

  it("still drops what a mic heard while its owner was muted throughout", async () => {
    // The other half of the rule: a member muted before the words began is not
    // their speaker — the recognizer heard the room, and relabelling it would
    // put someone else's words under their name.
    joinChoice.micEnabled = false;
    const sr = installSpeakingRecognition();
    try {
      await enterCall();
      await flush(2_000, 8);

      await act(async () => {
        sr.instances[0]?.onresult?.(finalResult("words from the room"));
        await Promise.resolve();
      });

      expect(broadcastLines()).toEqual([]);
    } finally {
      sr.restore();
    }
  });
});

describe("a phrase the engine invented from silence", () => {
  /**
   * A speech engine fed room tone does not stay silent — it flushes short
   * fluent phrases it made up, usually unscored. One of those used to land at
   * exactly the model floor and reach the report as something the member said.
   * The record keeps it either way; what changes is that nothing in the room
   * now presents it to the model as speech.
   */
  function installRecognition() {
    const instances: Array<{
      onstart: (() => void) | null;
      onspeechstart: (() => void) | null;
      onresult: ((ev: unknown) => void) | null;
    }> = [];
    class Recognition {
      continuous = false; interimResults = false; lang = "";
      onstart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onresult: ((ev: unknown) => void) | null = null;
      onerror = null; onend = null;
      constructor() { instances.push(this); }
      start() { this.onstart?.(); }
      stop() {}
    }
    const w = window as unknown as { SpeechRecognition?: unknown };
    const previous = w.SpeechRecognition;
    w.SpeechRecognition = Recognition;
    return { instances, restore: () => { w.SpeechRecognition = previous; } };
  }

  const finalResult = (text: string, confidence: number) => ({
    resultIndex: 0,
    results: [Object.assign([{ transcript: text, confidence }], { isFinal: true })],
  });

  const broadcastConfidences = () =>
    sent
      .map((m) => (m as { payload?: { type?: string; confidence?: number } }).payload)
      .filter((p) => p?.type === "transcript")
      .map((p) => p!.confidence!);

  it("is published below the model floor when nobody was audible and the engine never scored it", async () => {
    joinChoice.micEnabled = true;
    const sr = installRecognition();
    try {
      await enterCall();
      // The meter runs over genuine silence — a measurement, not a missing meter.
      await flush(2_000, 8);

      await act(async () => {
        // Confidence 0 is an engine that did not score, not one that scored zero.
        sr.instances[0]?.onresult?.(finalResult("Thank you.", 0));
        await Promise.resolve();
      });

      const sentConf = broadcastConfidences();
      expect(sentConf.length).toBe(1);
      expect(sentConf[0]).toBeLessThan(0.35);
    } finally {
      sr.restore();
    }
  });

  it("leaves real speech alone, scored or spoken aloud", async () => {
    joinChoice.micEnabled = true;
    const sr = installRecognition();
    try {
      await enterCall();
      await act(async () => { sr.instances[0]?.onspeechstart?.(); await Promise.resolve(); });
      await talkFor(2_000, "audio-local");

      await act(async () => {
        sr.instances[0]?.onresult?.(finalResult("let's begin", 0.92));
        await Promise.resolve();
      });

      const sentConf = broadcastConfidences();
      expect(sentConf.length).toBe(1);
      expect(sentConf[0]).toBeGreaterThan(0.6);
    } finally {
      sr.restore();
    }
  });
});
