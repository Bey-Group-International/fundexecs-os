/**
 * The echo warning, before anyone can hear the echo.
 *
 * The browser's echo canceller subtracts what is being PLAYED from what is
 * being CAPTURED, and it holds that reference for the default render device.
 * Choosing a different output moves the audio off it and the capture does not
 * follow — so sound leaves a speaker the canceller cannot hear, nothing is
 * subtracted, and every other person on the call starts hearing themselves
 * back. The member who caused it is the one person who cannot hear it.
 *
 * The green room is the better of the two places to say so, because nothing is
 * live yet. These tests are about that, and about the thing that would make the
 * warning worse than useless: firing it at somebody wearing a headset.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeetingGreenRoom } from "./MeetingGreenRoom";

jest.mock("./BackgroundPicker", () => ({ BackgroundPicker: () => null }));
jest.mock("../MeetingShareLink", () => ({ MeetingShareLink: () => null }));
jest.mock("@/lib/meetings/background-processor", () => ({ BackgroundProcessor: class {} }));
jest.mock("@/lib/meetings/background-store", () => ({ getBackground: async () => null }));

type Constraints = { video?: unknown; audio?: unknown };

function track(kind: "video" | "audio", deviceId: string) {
  return {
    kind,
    id: deviceId,
    readyState: "live",
    enabled: true,
    stop: jest.fn(),
    getSettings: () => ({ deviceId }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

/**
 * A laptop with its own mic and speakers, a pair of desk speakers on their own
 * bus, and a headset whose capture and render share a groupId — which is the
 * spec guarantee the rule is built on.
 */
const DEVICES = [
  { deviceId: "cam-1", kind: "videoinput", label: "FaceTime HD", groupId: "g-laptop" },
  { deviceId: "mic-laptop", kind: "audioinput", label: "MacBook Mic", groupId: "g-laptop" },
  { deviceId: "out-laptop", kind: "audiooutput", label: "MacBook Speakers", groupId: "g-laptop" },
  { deviceId: "out-desk", kind: "audiooutput", label: "Desk Speakers", groupId: "g-desk" },
  { deviceId: "mic-headset", kind: "audioinput", label: "Jabra", groupId: "g-headset" },
  { deviceId: "out-headset", kind: "audiooutput", label: "Jabra", groupId: "g-headset" },
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
  // The level meter is not what these test, and jsdom has no AudioContext.
  (globalThis as Record<string, unknown>).AudioContext = undefined;
});

beforeEach(() => {
  window.localStorage.clear();
  getUserMedia = jest.fn(async (c: Constraints) => {
    const requested = (constraint: unknown): string => {
      if (!constraint || typeof constraint !== "object") return "";
      return (constraint as { deviceId?: { exact?: string } }).deviceId?.exact ?? "";
    };
    const tracks = [];
    if (c.video) tracks.push(track("video", requested(c.video) || "cam-1"));
    if (c.audio) tracks.push(track("audio", requested(c.audio) || "mic-laptop"));
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

async function show() {
  await act(async () => { render(<MeetingGreenRoom {...base} />); });
  // The device list arrives a turn later, as it does from a real browser.
  await waitFor(() => expect(screen.getByLabelText("Speaker")).toBeInTheDocument());
}

const warning = () => screen.queryByText(/echo cancellation cannot remove it|other than your system default/i);

async function pickSpeaker(deviceId: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Speaker"), { target: { value: deviceId } });
  });
}

async function pickMic(deviceId: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Microphone"), { target: { value: deviceId } });
  });
}

describe("the echo warning in the green room", () => {
  it("says nothing before anything has been changed", async () => {
    await show();
    expect(warning()).not.toBeInTheDocument();
  });

  it("warns when output moves to a device the microphone is not on", async () => {
    await show();
    await pickSpeaker("out-desk");
    expect(warning()).toBeInTheDocument();
  });

  it("tells them what to do about it", async () => {
    // A warning that names a problem and no remedy is a warning people learn
    // to scroll past.
    await show();
    await pickSpeaker("out-desk");
    expect(screen.getByText(/headphones|system default/i)).toBeInTheDocument();
  });

  it("stays quiet for a headset, whose mic and speakers are one device", async () => {
    // The case that would make this feature actively annoying: warning the
    // person who has already solved the problem. `groupId` is what makes this
    // a fact rather than a guess at the product name "Jabra".
    await show();
    await pickMic("mic-headset");
    await pickSpeaker("out-headset");
    expect(warning()).not.toBeInTheDocument();
  });

  it("stays quiet for the laptop's own speakers, which share the mic's device", async () => {
    await show();
    await pickSpeaker("out-laptop");
    expect(warning()).not.toBeInTheDocument();
  });

  it("clears again when the member moves output back", async () => {
    await show();
    await pickSpeaker("out-desk");
    expect(warning()).toBeInTheDocument();

    await pickSpeaker("out-laptop");
    expect(warning()).not.toBeInTheDocument();
  });

  it("re-evaluates when the MICROPHONE changes, not only the speaker", async () => {
    // Plugging in a headset and selecting only its microphone leaves output on
    // the desk speakers — still risky, and the warning has to notice that the
    // risk is now on the other side of the pair.
    await show();
    await pickSpeaker("out-desk");
    expect(warning()).toBeInTheDocument();

    await pickMic("mic-headset");
    expect(warning()).toBeInTheDocument();

    await pickSpeaker("out-headset");
    expect(warning()).not.toBeInTheDocument();
  });
});
