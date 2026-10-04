/**
 * The green room as a GATE, for an invite-link guest.
 *
 * Until now this screen showed everything and required nothing: the Join button
 * was disabled while a join was in flight and at no other time, and `canJoin` in
 * lib/meetings/devices carries a comment saying that was on purpose. So the
 * commonest way to arrive in a call unheard was to walk past a screen that was
 * already explaining why.
 *
 * The rules are in lib/meetings/device-check.ts and tested there. These are
 * about the wiring the rules cannot see: that the button is actually disabled,
 * that a guest's Yes is only worth anything with a measurement behind it, that
 * the latch survives switching the camera off, and that a host is not gated at
 * all.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MeetingGreenRoom } from "./MeetingGreenRoom";

jest.mock("./BackgroundPicker", () => ({ BackgroundPicker: () => null }));
jest.mock("../MeetingShareLink", () => ({ MeetingShareLink: () => null }));
jest.mock("@/lib/meetings/background-processor", () => ({ BackgroundProcessor: class {} }));
jest.mock("@/lib/meetings/background-store", () => ({ getBackground: async () => null }));

/**
 * Whether the fake microphone is making a sound.
 *
 * Mutable, because the one case worth most here is a guest who presses Yes with
 * nothing arriving — which is the lens-cap failure and the pressed-without-
 * looking failure in the same shape, and the reason a measurement alone and a
 * confirmation alone are both insufficient.
 */
let micIsLive = true;

/** Whether the fake camera has produced a frame. A track is born muted. */
let cameraIsLive = true;


function track(kind: "video" | "audio", deviceId: string) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    kind,
    id: deviceId,
    readyState: "live",
    enabled: true,
    // The camera's own report of whether frames are flowing, which is what the
    // green room reads rather than the rendered preview.
    get muted() { return kind === "video" ? !cameraIsLive : false; },
    stop: jest.fn(),
    getSettings: () => ({ deviceId }),
    addEventListener: (ev: string, fn: () => void) => { (listeners[ev] ??= []).push(fn); },
    removeEventListener: () => {},
  };
}

const DEVICES = [
  { deviceId: "cam-default", kind: "videoinput", label: "FaceTime HD", groupId: "g1" },
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

  /** An AudioContext whose analyser reports a voice, or silence, on demand. */
  (globalThis as Record<string, unknown>).AudioContext = class {
    state = "running";
    createMediaStreamSource() { return { connect: () => {}, disconnect: () => {} }; }
    createAnalyser() {
      return {
        fftSize: 1024,
        connect: () => {},
        getFloatTimeDomainData: (buf: Float32Array) => {
          const v = micIsLive ? 0.6 : 0;
          for (let i = 0; i < buf.length; i++) buf[i] = v;
        },
      };
    }
    async close() {}
    async resume() {}
  };
});

beforeEach(() => {
  window.localStorage.clear();
  micIsLive = true;
  cameraIsLive = true;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: jest.fn(async (c: { video?: unknown; audio?: unknown }) => {
        const tracks = [];
        if (c.video) tracks.push(track("video", "cam-default"));
        if (c.audio) tracks.push(track("audio", "mic-default"));
        return new (globalThis as { MediaStream: new (t: unknown[]) => MediaStream }).MediaStream(tracks);
      }),
      enumerateDevices: jest.fn(async () => DEVICES),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
});

async function show(props: Partial<typeof base> & { isGuest?: boolean } = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<MeetingGreenRoom {...base} {...props} />); });
  // The meter runs on requestAnimationFrame; give it frames to see a voice in.
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  return view;
}

const joinButton = () => screen.getByRole("button", { name: /join meeting|start meeting|join to listen/i });

/** The Yes button inside the row whose text contains `within`. */
function answerYes(within: RegExp) {
  const row = screen.getByText(within).closest("li");
  if (!row) throw new Error(`no row for ${within}`);
  fireEvent.click(within_(row, "Yes"));
}
function answerNo(within: RegExp) {
  const row = screen.getByText(within).closest("li");
  if (!row) throw new Error(`no row for ${within}`);
  fireEvent.click(within_(row, "No"));
}
function within_(row: Element, label: string): Element {
  const found = [...row.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no ${label} in row`);
  return found;
}

describe("a guest arriving by invite link", () => {
  it("cannot join until the check is done", async () => {
    await show({ isGuest: true });
    expect(joinButton()).toBeDisabled();
    // And is told which device is in the way rather than that something is.
    expect(screen.getByText(/before joining/i)).toBeInTheDocument();
  });

  it("is asked about each device once it is producing", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());
    expect(screen.getByText(/do the bars move/i)).toBeInTheDocument();
  });

  it("is let in once the browser and the guest agree about both", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());

    answerYes(/can you see yourself/i);
    // One of two is not enough.
    expect(joinButton()).toBeDisabled();

    answerYes(/do the bars move/i);
    await waitFor(() => expect(joinButton()).toBeEnabled());
  });

  /**
   * The assertion the whole design rests on. A guest who presses Yes with
   * nothing arriving is the lens cap and the didn't-look button press in one
   * shape, and a confirmation with no measurement behind it must buy nothing.
   */
  it("is not let in by saying yes to a microphone that is making no sound", async () => {
    micIsLive = false;
    await show({ isGuest: true });

    answerYes(/can you see yourself/i);
    // The microphone row has no question to answer — there is nothing to
    // confirm — so the gate stays shut on it.
    expect(screen.queryByText(/do the bars move/i)).not.toBeInTheDocument();
    expect(joinButton()).toBeDisabled();
  });

  /**
   * The camera half of the same rule, which the microphone test above does not
   * cover: a track that is open but has produced no frame is not a working
   * camera, and must not be confirmable.
   */
  it("is not let in by a camera that is open but sending no picture", async () => {
    cameraIsLive = false;
    await show({ isGuest: true });

    expect(screen.queryByText(/can you see yourself/i)).not.toBeInTheDocument();
    answerYes(/do the bars move/i);
    expect(joinButton()).toBeDisabled();
  });

  it("takes no for an answer, and says what to try", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());

    answerNo(/can you see yourself/i);
    await waitFor(() => expect(screen.getByText(/covering the lens/i)).toBeInTheDocument());
    expect(joinButton()).toBeDisabled();
    // Still answerable: the steps are what to change, the question is how they
    // say the change worked.
    expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument();
  });

  /**
   * The latch, from the side that matters to a real person: joining with the
   * camera off is a state this product supports, and "turn your camera on to be
   * let in, then turn it off again" has to actually work.
   */
  it("keeps the gate open when a checked camera is switched off again", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());
    answerYes(/can you see yourself/i);
    answerYes(/do the bars move/i);
    await waitFor(() => expect(joinButton()).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /join with camera off/i }));
    await waitFor(() => expect(joinButton()).toBeEnabled());
  });

  /**
   * And from the side that matters to the guarantee: what was proved was one
   * piece of hardware, so picking a different one asks the question again.
   * Otherwise somebody passes on a working webcam and joins on a broken one.
   */
  it("asks again when a different camera is chosen", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());
    answerYes(/can you see yourself/i);
    answerYes(/do the bars move/i);
    await waitFor(() => expect(joinButton()).toBeEnabled());

    // The pickers live behind the "Devices" fold.
    fireEvent.click(screen.getByText(/^Devices$/i).closest("button")!);
    fireEvent.change(screen.getByRole("combobox", { name: /camera/i }), { target: { value: "cam-other" } });

    await waitFor(() => expect(joinButton()).toBeDisabled());
  });
});

/**
 * The three defects CodeRabbit found in the first cut of this gate. Each one
 * made the check accuse somebody falsely, or pass a device it had not actually
 * measured, so each gets a test rather than a fix on trust.
 */
describe("what the check must not get wrong", () => {
  /**
   * NOT TESTED HERE, and deliberately said so rather than left to look covered.
   *
   * The camera's grace period now starts when the TRACK arrives rather than when
   * the device choice changes, because a timer keyed on the choice was already
   * running while the permission prompt was on screen and had expired by the
   * time a slow "Allow" produced a frame. The reachable path is a re-open —
   * "Try again" does not change `camId`, so the old keying never restarted the
   * timer and the row accused the camera the moment its track went away.
   *
   * Two attempts to pin that here passed for the wrong reason: during a pending
   * prompt the device list is still empty, so a named `no_camera` problem
   * outranks the signal and the row reads the same either way. Reproducing the
   * re-open case needs more scaffolding than the one-line fix warrants, so this
   * line is held by reading. The fix is in MeetingGreenRoom's camera grace-period
   * effect, which says the same thing beside the code.
   */

  /**
   * Muting before the check used to reach the "blocked" stage, where the row
   * said the microphone was picking nothing up and offered a list of other
   * microphones — advice aimed at hardware, given to somebody who had pressed
   * the mute button. The camera had this case handled and the microphone did
   * not.
   */
  it("asks a muted guest to unmute rather than telling them their mic is broken", async () => {
    await show({ isGuest: true });
    fireEvent.click(screen.getByRole("button", { name: /join muted/i }));

    await waitFor(() => expect(screen.getByText(/unmute so your microphone/i)).toBeInTheDocument());
    expect(screen.queryByText(/pick a different microphone/i)).not.toBeInTheDocument();
    expect(joinButton()).toBeDisabled();
  });

  /**
   * And it says the mute is not a one-way door, because the latch means it
   * genuinely is not.
   */
  it("tells them the mute can go back on afterwards", async () => {
    await show({ isGuest: true });
    fireEvent.click(screen.getByRole("button", { name: /join muted/i }));
    await waitFor(() => expect(screen.getByText(/mute again before you join/i)).toBeInTheDocument());
  });
});

describe("a host or a member", () => {
  /**
   * Not gated, and that is the decision rather than an oversight: somebody with
   * colleagues in the room is told within seconds that they cannot be heard, and
   * being made late to their own meeting costs them more than a quiet first
   * minute.
   */
  it("can join straight away, with no check in the way", async () => {
    await show({ isGuest: false });
    expect(joinButton()).toBeEnabled();
    expect(screen.queryByText(/can you see yourself/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/do the bars move/i)).not.toBeInTheDocument();
  });
});
