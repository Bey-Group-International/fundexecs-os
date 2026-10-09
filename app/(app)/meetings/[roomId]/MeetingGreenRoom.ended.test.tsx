/**
 * A preview device that ends while somebody sits in the green room.
 *
 * A guest in the waiting room is the person most likely to be on a phone and
 * the most likely to be kept waiting, and a phone that is put down stops its
 * capture: on return the track has ENDED. Nothing was listening, so the preview
 * went black and the meter went flat and stayed that way — through the wait,
 * and through the device check, which then blamed a camera that would have
 * opened fine if asked.
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { MeetingGreenRoom } from "./MeetingGreenRoom";
import { PREVIEW_REOPEN_LIMIT, PREVIEW_STABLE_MS } from "@/lib/meetings/preview-recovery";

jest.mock("./BackgroundPicker", () => ({ BackgroundPicker: () => null }));
jest.mock("../MeetingShareLink", () => ({ MeetingShareLink: () => null }));
jest.mock("@/lib/meetings/background-processor", () => ({ BackgroundProcessor: class {} }));
jest.mock("@/lib/meetings/background-store", () => ({ getBackground: async () => null }));

type Constraints = { video?: unknown; audio?: unknown };

/** A track that can be ended the way a real one is: by its source going away. */
interface FakeTrack {
  kind: string;
  id: string;
  readyState: string;
  enabled: boolean;
  muted: boolean;
  stop: jest.Mock;
  getSettings: () => { deviceId: string };
  addEventListener: (ev: string, fn: () => void) => void;
  removeEventListener: (ev: string, fn: () => void) => void;
  /** The source went away. Fires `ended` on every listener, as a browser does. */
  end: () => void;
}

/** Every track the mocked getUserMedia has handed out, newest last. */
const opened: FakeTrack[] = [];

function track(kind: "video" | "audio", deviceId: string): FakeTrack {
  const listeners = new Map<string, Set<() => void>>();
  const t: FakeTrack = {
    kind,
    id: `${deviceId}-${opened.length}`,
    readyState: "live",
    enabled: true,
    muted: false,
    stop: jest.fn(() => { t.readyState = "ended"; }),
    getSettings: () => ({ deviceId }),
    addEventListener: (ev, fn) => { (listeners.get(ev) ?? listeners.set(ev, new Set()).get(ev)!).add(fn); },
    removeEventListener: (ev, fn) => { listeners.get(ev)?.delete(fn); },
    end: () => {
      t.readyState = "ended";
      for (const fn of [...(listeners.get("ended") ?? [])]) fn();
    },
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

const DEVICES = [
  { deviceId: "cam-default", kind: "videoinput", label: "FaceTime HD", groupId: "g1" },
  // A second camera, so a test can pick a different one.
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
  (globalThis as Record<string, unknown>).AudioContext = undefined;
});

beforeEach(() => {
  window.localStorage.clear();
  opened.length = 0;
  getUserMedia = jest.fn(async (c: Constraints) => {
    const tracks: FakeTrack[] = [];
    if (c.video) tracks.push(track("video", requestedId(c.video) || "cam-default"));
    if (c.audio) tracks.push(track("audio", requestedId(c.audio) || "mic-default"));
    return new (globalThis as { MediaStream: new (t: unknown[]) => MediaStream }).MediaStream(tracks);
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: jest.fn(() => new Promise((r) => setTimeout(() => r(DEVICES), 0))),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
});

async function show(props: Partial<typeof base> = {}) {
  await act(async () => { render(<MeetingGreenRoom {...base} {...props} />); });
  // The first open, and the enumeration that follows it, have settled.
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

const videoRequests = () => getUserMedia.mock.calls.filter(([c]: [Constraints]) => c.video).length;
const audioRequests = () => getUserMedia.mock.calls.filter(([c]: [Constraints]) => c.audio).length;
const liveOf = (kind: string) => opened.filter((t) => t.kind === kind && t.readyState === "live");

describe("a camera that ends while waiting", () => {
  it("is opened again", async () => {
    await show();
    expect(videoRequests()).toBe(1);
    const camera = opened.find((t) => t.kind === "video")!;

    await act(async () => { camera.end(); });

    await waitFor(() => expect(videoRequests()).toBe(2));
    // The same camera is asked for first: it is only gone if it says so.
    const [again] = getUserMedia.mock.calls[1] as [Constraints];
    expect(again.video).toBeTruthy();
    // And only the camera: the microphone was never the problem.
    expect(again.audio).toBeFalsy();
    await waitFor(() => expect(liveOf("video")).toHaveLength(1));
  });
});

describe("a microphone that ends while waiting", () => {
  it("is opened again, on its own", async () => {
    await show();
    expect(audioRequests()).toBe(1);
    const mic = opened.find((t) => t.kind === "audio")!;

    await act(async () => { mic.end(); });

    await waitFor(() => expect(audioRequests()).toBe(2));
    const [again] = getUserMedia.mock.calls[1] as [Constraints];
    expect(again.audio).toBeTruthy();
    expect(again.video).toBeFalsy();
    // The camera it was opened beside was not touched.
    expect(videoRequests()).toBe(1);
    await waitFor(() => expect(liveOf("audio")).toHaveLength(1));
  });
});

describe("a camera that keeps ending", () => {
  /**
   * A device that opens and then ends on its own, over and over — a failing
   * cable, a virtual-camera app crash-looping — was reopened once per cycle
   * for as long as a guest sat waiting. See preview-recovery.ts.
   */
  let now: number;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  /** The newest camera ends, a moment after it opened. */
  async function cameraDies(afterMs = 500) {
    now += afterMs;
    const cameras = opened.filter((t) => t.kind === "video");
    await act(async () => { cameras[cameras.length - 1].end(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }

  it("is reopened a few times, then left alone until the member asks", async () => {
    await show();
    for (let i = 1; i <= PREVIEW_REOPEN_LIMIT; i++) {
      await cameraDies();
      await waitFor(() => expect(videoRequests()).toBe(1 + i));
    }

    // One more short-lived replacement ends: nothing is asked for.
    await cameraDies();
    expect(videoRequests()).toBe(1 + PREVIEW_REOPEN_LIMIT);
    // And the dead track was let go rather than left frozen on the preview.
    expect(liveOf("video")).toHaveLength(0);

    // The member picks another camera, which is them asking: a fresh budget.
    const picker = document.querySelector("select") as HTMLSelectElement | null;
    expect(picker).not.toBeNull();
    await act(async () => {
      fireEvent.change(picker!, { target: { value: "cam-other" } });
      await Promise.resolve();
    });
    await waitFor(() => expect(videoRequests()).toBe(2 + PREVIEW_REOPEN_LIMIT));
    await waitFor(() => expect(liveOf("video")).toHaveLength(1));
  });

  // A replacement that stayed up long enough to have plainly worked is a
  // working device, and its ending is a new event rather than the next turn
  // of the same cycle.
  it("starts counting again once a replacement has stayed up a while", async () => {
    await show();
    for (let i = 1; i <= PREVIEW_REOPEN_LIMIT; i++) {
      await cameraDies();
      await waitFor(() => expect(videoRequests()).toBe(1 + i));
    }

    await cameraDies(PREVIEW_STABLE_MS);
    await waitFor(() => expect(videoRequests()).toBe(2 + PREVIEW_REOPEN_LIMIT));
  });

  // The microphone was never the problem and keeps its own count.
  it("does not spend the microphone's budget", async () => {
    await show();
    for (let i = 1; i <= PREVIEW_REOPEN_LIMIT + 1; i++) await cameraDies();
    expect(audioRequests()).toBe(1);

    const mic = opened.find((t) => t.kind === "audio")!;
    await act(async () => { mic.end(); });
    await waitFor(() => expect(audioRequests()).toBe(2));
  });
});

describe("a track the call has taken, or is taking", () => {
  // Once the room adopts the preview, the device is the room's to recover —
  // its own listener moves the call to the system default — and two repairs
  // racing for one camera is the race the join path exists to avoid.
  it("is not reopened once released to the call", async () => {
    let release: (() => void) | null = null;
    await show({
      onPreviewStream: (_stream: MediaStream | null, relinquish: () => void) => { release = relinquish; },
    } as Partial<typeof base>);
    expect(release).not.toBeNull();
    const camera = opened.find((t) => t.kind === "video")!;

    act(() => { release!(); });
    await act(async () => { camera.end(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(videoRequests()).toBe(1);
  });

  it("is not reopened while a join is in flight", async () => {
    await show({ joining: true });
    const camera = opened.find((t) => t.kind === "video")!;

    await act(async () => { camera.end(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(videoRequests()).toBe(1);
  });
});
