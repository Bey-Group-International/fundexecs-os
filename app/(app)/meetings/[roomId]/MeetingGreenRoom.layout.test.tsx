/**
 * The green room's second pass: a device problem said large, the pickers folded
 * away, and a clock on the wait.
 *
 *   - A blocked or busy device used to be a line of 12px text under the name
 *     field telling people to "allow it in the address bar, then reload". It is
 *     now over the preview, with steps, and Try again asks the browser again
 *     without the reload — which would have cost the typed name and a place in
 *     the waiting room.
 *   - The three device dropdowns are one line until opened, and a problem the
 *     pickers can fix opens them.
 *   - A wait says how long it has been.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeetingGreenRoom } from "./MeetingGreenRoom";

jest.mock("./BackgroundPicker", () => ({ BackgroundPicker: () => null }));
jest.mock("../MeetingShareLink", () => ({ MeetingShareLink: () => null }));
jest.mock("@/lib/meetings/background-processor", () => ({ BackgroundProcessor: class {} }));
jest.mock("@/lib/meetings/background-store", () => ({ getBackground: async () => null }));

const DEVICES = [
  { deviceId: "cam-1", kind: "videoinput", label: "FaceTime HD Camera (05ac:8514)", groupId: "g1" },
  { deviceId: "mic-1", kind: "audioinput", label: "Default - MacBook Pro Microphone", groupId: "g1" },
  { deviceId: "spk-1", kind: "audiooutput", label: "MacBook Pro Speakers", groupId: "g1" },
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

function track(kind: "video" | "audio", deviceId: string) {
  return {
    kind, id: deviceId, readyState: "live", enabled: true, stop: jest.fn(),
    getSettings: () => ({ deviceId }), addEventListener: jest.fn(), removeEventListener: jest.fn(),
  };
}

function stream(c: { video?: unknown; audio?: unknown }) {
  const tracks = [];
  if (c.video) tracks.push(track("video", "cam-1"));
  if (c.audio) tracks.push(track("audio", "mic-1"));
  return new (globalThis as { MediaStream: new (t: unknown[]) => MediaStream }).MediaStream(tracks);
}

function denied() {
  const err = new Error("denied");
  err.name = "NotAllowedError";
  return err;
}

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
  getUserMedia = jest.fn(async (c) => stream(c));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: jest.fn().mockResolvedValue(DEVICES),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
});

async function show(extra: Record<string, unknown> = {}) {
  await act(async () => { render(<MeetingGreenRoom {...base} {...extra} />); });
}

describe("a blocked device", () => {
  it("is explained over the preview, and Try again asks the browser again", async () => {
    getUserMedia.mockRejectedValue(denied());
    await show();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your microphone is blocked");
    expect(alert).toHaveTextContent(/then press try again/i);

    // The person allows it in the address bar; the browser now says yes.
    getUserMedia.mockImplementation(async (c) => stream(c));
    const before = getUserMedia.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });

    expect(getUserMedia.mock.calls.length).toBeGreaterThan(before);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("does not cover the preview for a camera that is merely missing", async () => {
    (navigator.mediaDevices.enumerateDevices as jest.Mock).mockResolvedValue(DEVICES.filter((d) => d.kind !== "videoinput"));
    getUserMedia.mockImplementation(async (c) => {
      if (c.video) { const e = new Error("none"); e.name = "NotFoundError"; throw e; }
      return stream(c);
    });
    await show();
    await waitFor(() => expect(screen.getByText(/no camera found/i)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("the device pickers", () => {
  it("are one line until opened, naming the devices in use", async () => {
    await show();
    const toggle = await screen.findByRole("button", { name: /devices/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(toggle).toHaveTextContent("FaceTime HD Camera · MacBook Pro Microphone"));
    expect(screen.getByLabelText("Camera").closest("[hidden]")).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Camera").closest("[hidden]")).toBeNull();
  });

  it("open themselves when the chosen speaker would echo", async () => {
    // A speaker in a different group from the microphone, chosen explicitly.
    (navigator.mediaDevices.enumerateDevices as jest.Mock).mockResolvedValue([
      ...DEVICES,
      { deviceId: "spk-2", kind: "audiooutput", label: "Living Room", groupId: "g9" },
    ]);
    await show();
    await waitFor(() => expect(screen.getByLabelText("Speaker")).toBeInTheDocument());
    await act(async () => { fireEvent.change(screen.getByLabelText("Speaker"), { target: { value: "spk-2" } }); });
    expect(screen.getByRole("button", { name: /devices/i })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("waiting to be let in", () => {
  afterEach(() => jest.useRealTimers());

  it("shows how long the wait has been", async () => {
    jest.useFakeTimers();
    await show({ admission: "waiting", onCancelAdmission: jest.fn() });
    expect(screen.getByText("Waiting 0:00")).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(65_000); });
    expect(screen.getByText("Waiting 1:05")).toBeInTheDocument();
  });

  it("has no clock while only asking", async () => {
    await show({ admission: "asking" });
    expect(screen.queryByText(/^Waiting \d/)).not.toBeInTheDocument();
  });
});
