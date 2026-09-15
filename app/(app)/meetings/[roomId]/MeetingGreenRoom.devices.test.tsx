/**
 * Opening a camera and a microphone before anyone can see or hear you.
 *
 * Three failures, all of which reach the member as "this thing doesn't work"
 * and none of which say so:
 *
 *   - A remembered device that has since been unplugged. The green room forgets
 *     it and is supposed to re-open against the system default; the effects that
 *     do that stood down until the first combined open had settled, and the flag
 *     they read was a ref, so nothing re-ran them afterwards. The member sat
 *     looking at "No camera found" with a working camera plugged in.
 *   - A device another application is holding, reported as a device that is not
 *     there. Those have different fixes, and only one of them involves going to
 *     look for hardware.
 *   - A camera that is busy for a few milliseconds because the page that was
 *     just here has not finished letting go of it. The call retries that; the
 *     screen that decides whether you HAVE a camera did not.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeetingGreenRoom } from "./MeetingGreenRoom";
import { DEVICE_PREF_KEYS } from "@/lib/meetings/devices";

jest.mock("./BackgroundPicker", () => ({ BackgroundPicker: () => null }));
jest.mock("../MeetingShareLink", () => ({ MeetingShareLink: () => null }));
jest.mock("@/lib/meetings/background-processor", () => ({ BackgroundProcessor: class {} }));
jest.mock("@/lib/meetings/background-store", () => ({ getBackground: async () => null }));

type Constraints = { video?: unknown; audio?: unknown };

/** Every track the mocked getUserMedia has handed out, newest last. */
const opened: Array<{ kind: string; id: string; stop: jest.Mock }> = [];

function track(kind: "video" | "audio", deviceId: string) {
  const t = {
    kind,
    id: deviceId,
    readyState: "live",
    enabled: true,
    stop: jest.fn(),
    getSettings: () => ({ deviceId }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  opened.push(t);
  return t;
}

/** The deviceId an exact constraint is asking for, or "" for the default. */
function requestedId(constraint: unknown): string {
  if (!constraint || typeof constraint !== "object") return "";
  const id = (constraint as { deviceId?: { exact?: string } }).deviceId;
  return id?.exact ?? "";
}

function domError(name: string) {
  const err = new Error(name);
  err.name = name;
  return err;
}

const DEVICES = [
  { deviceId: "cam-default", kind: "videoinput", label: "FaceTime HD", groupId: "g1" },
  // A second camera, so a test can pick a different one and make the screen
  // actually replace a track.
  { deviceId: "cam-other", kind: "videoinput", label: "Studio Display", groupId: "g2" },
  { deviceId: "mic-default", kind: "audioinput", label: "MacBook Mic", groupId: "g1" },
];

const base = {
  roomCode: "abc-defg-hi",
  isHost: false,
  joining: false,
  displayName: "Ada",
  onDisplayNameChange: jest.fn(),
  meetingTitle: "Series B Diligence",
  onJoin: jest.fn(),
};

let getUserMedia: jest.Mock;

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true, value: jest.fn().mockResolvedValue(undefined),
  });
  (globalThis as Record<string, unknown>).MediaStream = class {
    constructor(private readonly tracks: unknown[] = []) {}
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter((t) => (t as { kind: string }).kind === "video"); }
    getAudioTracks() { return this.tracks.filter((t) => (t as { kind: string }).kind === "audio"); }
  };
  // No AudioContext in jsdom, and the meter is not what these test.
  (globalThis as Record<string, unknown>).AudioContext = undefined;
});

beforeEach(() => {
  window.localStorage.clear();
  opened.length = 0;
  getUserMedia = jest.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      // Deferred by a turn on purpose. The first open awaits this after it has
      // already called setCamId("")/setMicId(""), so React gets to render and
      // run the per-device effects BEFORE the open finishes priming them. That
      // is the ordering a real browser produces — enumerateDevices is a genuine
      // round trip — and the ordering the old ref-based guard lost.
      enumerateDevices: jest.fn(() => new Promise((r) => setTimeout(() => r(DEVICES), 0))),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
});

async function show() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<MeetingGreenRoom {...base} />); });
  return view;
}

/** Every deviceId a video request asked for, in order. */
function videoRequests(): string[] {
  return getUserMedia.mock.calls
    .map(([c]: [Constraints]) => c)
    .filter((c) => c.video)
    .map((c) => requestedId(c.video));
}

describe("a remembered device that has been unplugged", () => {
  beforeEach(() => {
    window.localStorage.setItem(DEVICE_PREF_KEYS.videoinput, "gone-cam");
    window.localStorage.setItem(DEVICE_PREF_KEYS.audioinput, "gone-mic");
    getUserMedia.mockImplementation(async (c: Constraints) => {
      // An exact constraint on hardware that is no longer there is what the
      // browser reports as overconstrained.
      if (c.video && requestedId(c.video) === "gone-cam") throw domError("OverconstrainedError");
      if (c.audio && requestedId(c.audio) === "gone-mic") throw domError("OverconstrainedError");
      const tracks = [];
      if (c.video) tracks.push(track("video", "cam-default"));
      if (c.audio) tracks.push(track("audio", "mic-default"));
      return new (globalThis as { MediaStream: new (t: unknown[]) => MediaStream }).MediaStream(tracks);
    });
  });

  it("falls back to the system default instead of leaving a black preview", async () => {
    await show();
    await waitFor(() => expect(videoRequests()).toContain(""));
    // The preview is live, so the placeholder that stood in for it is gone.
    await waitFor(() => expect(screen.queryByText(/no camera/i)).not.toBeInTheDocument());
  });

  it("does not tell someone their working microphone is missing", async () => {
    await show();
    await waitFor(() => {
      const audio = getUserMedia.mock.calls.map(([c]: [Constraints]) => c).filter((c) => c.audio);
      expect(audio.some((c) => requestedId(c.audio) === "")).toBe(true);
    });
    expect(screen.queryByText(/no microphone found/i)).not.toBeInTheDocument();
  });
});

describe("a device another application is holding", () => {
  it("says it is taken, not that it is missing", async () => {
    getUserMedia.mockImplementation(async (c: Constraints) => {
      if (c.video) throw domError("NotReadableError");
      return new (globalThis as { MediaStream: new (t: unknown[]) => MediaStream }).MediaStream([track("audio", "mic-default")]);
    });
    await show();
    await waitFor(() => expect(screen.getByText(/another app is using your camera/i)).toBeInTheDocument());
    expect(screen.queryByText(/no camera found/i)).not.toBeInTheDocument();
  });
});

describe("a camera the previous page has not finished releasing", () => {
  // Asked for as one request so there is one permission prompt. Giving up on
  // the combined request at the first "busy" splits it into two, which is the
  // fallback for a device that is genuinely unavailable — not for one that is
  // three hundred milliseconds from being free.
  it("asks again as one request rather than splitting the prompt", async () => {
    let attempts = 0;
    getUserMedia.mockImplementation(async (c: Constraints) => {
      attempts += 1;
      // Busy on the first ask, free a moment later — which is what releasing a
      // camera on Windows actually looks like.
      if (attempts === 1) throw domError("NotReadableError");
      const tracks: unknown[] = [];
      if (c.video) tracks.push(track("video", "cam-default"));
      if (c.audio) tracks.push(track("audio", "mic-default"));
      return new (globalThis as { MediaStream: new (t: unknown[]) => MediaStream }).MediaStream(tracks);
    });

    await show();
    await waitFor(() => expect(screen.queryByText(/no camera/i)).not.toBeInTheDocument());

    const asks = getUserMedia.mock.calls.map(([c]: [Constraints]) => c);
    expect(asks.filter((c) => c.video && c.audio)).toHaveLength(2);
    // Never split: a second prompt for the microphone is exactly what the
    // combined request exists to avoid.
    expect(asks.filter((c) => c.audio && !c.video)).toHaveLength(0);
  });
});

// The contract the join path now leans on. The call takes these tracks over
// instead of closing them and opening the same two devices again — so the one
// thing this screen must not do afterwards is stop them. Getting this wrong is
// silent and total: the member is in the meeting, and nobody can hear them.
describe("handing the devices to the call", () => {
  /** Opens whatever was asked for, so switching devices yields a new track. */
  function openBoth() {
    getUserMedia.mockImplementation(async (c: Constraints) => {
      const tracks: unknown[] = [];
      if (c.video) tracks.push(track("video", requestedId(c.video) || "cam-default"));
      if (c.audio) tracks.push(track("audio", requestedId(c.audio) || "mic-default"));
      return new (globalThis as { MediaStream: new (t: unknown[]) => MediaStream }).MediaStream(tracks);
    });
  }

  /** Render, and return the tracks handed up plus the means to keep them. */
  async function handover() {
    const onPreviewStream = jest.fn();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<MeetingGreenRoom {...base} onPreviewStream={onPreviewStream} />);
    });
    await waitFor(() => expect(onPreviewStream).toHaveBeenCalled());
    const [stream, release] = onPreviewStream.mock.calls.at(-1) as [MediaStream, () => void];
    return { view, stream, release };
  }

  it("stops its devices on unmount when the call did not take them", async () => {
    openBoth();
    const { view, stream } = await handover();
    const tracks = stream.getTracks() as unknown as Array<{ stop: jest.Mock }>;
    expect(tracks.length).toBeGreaterThan(0);

    view.unmount();
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
  });

  it("leaves them alone once the call has taken them", async () => {
    openBoth();
    const { view, stream, release } = await handover();
    const tracks = stream.getTracks() as unknown as Array<{ stop: jest.Mock }>;
    expect(tracks.length).toBeGreaterThan(0);

    release();
    view.unmount();
    for (const t of tracks) expect(t.stop).not.toHaveBeenCalled();
  });

  // Not only on unmount: the per-device effects replace tracks too, and a
  // replacement that stopped the outgoing microphone would be the same bug
  // arriving a different way.
  //
  // Driven by actually picking a different camera, because that is what makes
  // adoptVideo run. An earlier version of this dispatched a `resize` on window,
  // which this screen does not listen to at all — so it exercised nothing and
  // would have passed with the guard deleted.
  it("does not stop a released track when replacing it either", async () => {
    openBoth();
    const { view, stream, release } = await handover();
    const before = stream.getVideoTracks() as unknown as Array<{ stop: jest.Mock }>;
    expect(before).toHaveLength(1);
    release();

    // The camera picker, after the handover. The screen opens the new device;
    // what it let go of keeps running.
    const picker = view.container.querySelector("select") as HTMLSelectElement | null;
    expect(picker).not.toBeNull();
    await act(async () => {
      fireEvent.change(picker!, { target: { value: "cam-other" } });
      await Promise.resolve();
    });
    await waitFor(() => expect(videoRequests()).toContain("cam-other"));

    for (const t of before) expect(t.stop).not.toHaveBeenCalled();
  });

  // The other half of scoping it to the tracks that were handed over: a device
  // opened AFTER the handover belongs to nobody, so leaving the page has to
  // stop it. A blanket "this screen owns nothing now" flag would leave a camera
  // lit with no owner at all.
  it("still stops a device opened after the handover", async () => {
    openBoth();
    const { view, stream, release } = await handover();
    const handed = stream.getVideoTracks() as unknown as Array<{ stop: jest.Mock }>;
    release();

    const picker = view.container.querySelector("select") as HTMLSelectElement | null;
    await act(async () => {
      fireEvent.change(picker!, { target: { value: "cam-other" } });
      await Promise.resolve();
    });
    await waitFor(() => expect(videoRequests()).toContain("cam-other"));
    const replacement = opened.find((t) => t.kind === "video" && t.id === "cam-other");
    expect(replacement).toBeDefined();

    view.unmount();
    // The handed-over one is the call's and survives; the later one does not.
    for (const t of handed) expect(t.stop).not.toHaveBeenCalled();
    expect(replacement!.stop).toHaveBeenCalled();
  });
});
