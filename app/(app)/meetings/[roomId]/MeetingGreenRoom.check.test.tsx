/**
 * The green room's device CHECK, for an invite-link guest.
 *
 * For a while this screen was a gate: the Join button stayed disabled until a
 * guest had confirmed both camera and microphone, and guests with no webcam, a
 * denied permission or an in-app browser could not get in at all. It is a check
 * now — it measures, asks, and says plainly what is still unverified — and the
 * button works throughout.
 *
 * The rules are in lib/meetings/device-check.ts and tested there. These are
 * about the wiring the rules cannot see: that the button really is live, that a
 * guest's Yes is only worth anything with a measurement behind it, that the
 * latch survives switching the camera off, and that a host sees none of it.
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
  base.onJoin.mockReset();
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
  // The meter reads the microphone on a timer, once at once; let it settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
  return view;
}

const joinButton = () => screen.getByRole("button", { name: /join meeting|start meeting|join to listen/i });

/** The sentence under the button while something is still unchecked. */
const note = () => screen.queryByText(/still join/i);

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
  it("can join straight away, and is told what is still unchecked", async () => {
    await show({ isGuest: true });
    expect(joinButton()).toBeEnabled();
    // Told which devices, and that the button works regardless.
    expect(note()).toBeInTheDocument();
    expect(note()!.textContent).toMatch(/microphone and camera/i);
  });

  /** The one promise the whole change rests on. */
  it("lets a guest with nothing checked press Join", async () => {
    micIsLive = false;
    cameraIsLive = false;
    await show({ isGuest: true });
    fireEvent.click(joinButton());
    expect(base.onJoin).toHaveBeenCalledTimes(1);
  });

  it("is asked about each device once it is producing", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());
    expect(screen.getByText(/do the bars move/i)).toBeInTheDocument();
  });

  it("stops being nagged once the browser and the guest agree about both", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());

    answerYes(/can you see yourself/i);
    // One of two is not enough — and the note now names the one that is left.
    await waitFor(() => expect(note()!.textContent).toMatch(/^Your microphone hasn't/i));
    expect(joinButton()).toBeEnabled();

    answerYes(/do the bars move/i);
    await waitFor(() => expect(note()).not.toBeInTheDocument());
    expect(joinButton()).toBeEnabled();
  });

  /**
   * A guest who presses Yes with nothing arriving is the lens cap and the
   * didn't-look button press in one shape, and a confirmation with no
   * measurement behind it must buy nothing — the row must still read unchecked.
   * What it must NOT do any more is keep them out.
   */
  it("does not count a yes about a microphone that is making no sound", async () => {
    micIsLive = false;
    await show({ isGuest: true });

    answerYes(/can you see yourself/i);
    // The microphone row has no question to answer — there is nothing to
    // confirm — so it stays unchecked, and the note says so.
    expect(screen.queryByText(/do the bars move/i)).not.toBeInTheDocument();
    await waitFor(() => expect(note()!.textContent).toMatch(/microphone/i));
    expect(joinButton()).toBeEnabled();
  });

  /**
   * The camera half of the same rule, which the microphone test above does not
   * cover: a track that is open but has produced no frame is not a working
   * camera, and must not be confirmable.
   */
  it("does not count a camera that is open but sending no picture", async () => {
    cameraIsLive = false;
    await show({ isGuest: true });

    expect(screen.queryByText(/can you see yourself/i)).not.toBeInTheDocument();
    answerYes(/do the bars move/i);
    await waitFor(() => expect(note()!.textContent).toMatch(/camera/i));
    expect(joinButton()).toBeEnabled();
  });

  it("takes no for an answer, and says what to try", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());

    answerNo(/can you see yourself/i);
    await waitFor(() => expect(screen.getByText(/covering the lens/i)).toBeInTheDocument());
    // Still answerable: the steps are what to change, the question is how they
    // say the change worked. And still joinable.
    expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument();
    expect(joinButton()).toBeEnabled();
  });

  /**
   * The latch, from the side that matters to a real person: joining with the
   * camera off is a state this product supports, and a camera that was checked
   * and then switched off must still read as checked.
   */
  it("keeps a checked camera checked when it is switched off again", async () => {
    await show({ isGuest: true });
    await waitFor(() => expect(screen.getByText(/can you see yourself/i)).toBeInTheDocument());
    answerYes(/can you see yourself/i);
    answerYes(/do the bars move/i);
    await waitFor(() => expect(note()).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /join with camera off/i }));
    await waitFor(() => expect(joinButton()).toBeEnabled());
    expect(note()).not.toBeInTheDocument();
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
    await waitFor(() => expect(note()).not.toBeInTheDocument());

    // The pickers live behind the "Devices" fold.
    fireEvent.click(screen.getByText(/^Devices$/i).closest("button")!);
    fireEvent.change(screen.getByRole("combobox", { name: /camera/i }), { target: { value: "cam-other" } });

    await waitFor(() => expect(note()!.textContent).toMatch(/camera/i));
    expect(joinButton()).toBeEnabled();
  });
});

/**
 * The three defects CodeRabbit found in the first cut of this check. Each one
 * made it accuse somebody falsely, or pass a device it had not actually
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
    expect(joinButton()).toBeEnabled();
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
   * Not shown the check at all, and that is the decision rather than an
   * oversight: somebody with colleagues in the room is told within seconds that
   * they cannot be heard, and a screen of questions in front of their own
   * meeting costs them more than a quiet first minute.
   */
  it("can join straight away, with no check in the way", async () => {
    await show({ isGuest: false });
    expect(joinButton()).toBeEnabled();
    expect(screen.queryByText(/can you see yourself/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/do the bars move/i)).not.toBeInTheDocument();
    expect(note()).not.toBeInTheDocument();
  });
});
