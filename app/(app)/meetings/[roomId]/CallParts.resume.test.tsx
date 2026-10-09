/**
 * Call media that plays again when the page comes back.
 *
 * A phone that is backgrounded — the member switches apps, takes a call, locks
 * the screen — pauses every media element on the page, and on return they are
 * allowed to stay paused. The connections are fine and the tracks are live; the
 * elements rendering them have simply stopped. `play()` was only ever called
 * when a stream was attached and on `canplay`, neither of which happens again,
 * so a glance at a text message left a room of frozen faces and no voices.
 */
import { act, render } from "@testing-library/react";
import { PeerAudio, VideoTile } from "./CallParts";

let play: jest.Mock;
let visibility: DocumentVisibilityState;

beforeAll(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

beforeEach(() => {
  visibility = "visible";
  play = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  // jsdom never plays anything, so every element reports paused — which is the
  // state under test. Made explicit so a jsdom that learns to play does not
  // silently turn these into tests of nothing.
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => true });
});

const track = (kind: "video" | "audio") => ({
  kind,
  id: kind,
  enabled: true,
  readyState: "live",
  addEventListener: () => {},
  removeEventListener: () => {},
});

function stream(...tracks: ReturnType<typeof track>[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  } as unknown as MediaStream;
}

function comeBack(how: "visibilitychange" | "pageshow") {
  act(() => {
    if (how === "visibilitychange") document.dispatchEvent(new Event("visibilitychange"));
    else window.dispatchEvent(new Event("pageshow"));
  });
}

describe("a face, after the page was hidden", () => {
  it("is played again when the page becomes visible", () => {
    const v = track("video");
    render(<VideoTile stream={stream(v)} videoTrack={v as unknown as MediaStreamTrack} label="Rae" />);
    const onAttach = play.mock.calls.length;
    expect(onAttach).toBeGreaterThan(0);

    comeBack("visibilitychange");
    expect(play.mock.calls.length).toBe(onAttach + 1);
  });

  // A page restored from the back-forward cache fires pageshow and not
  // visibilitychange.
  it("is played again when the page is restored", () => {
    const v = track("video");
    render(<VideoTile stream={stream(v)} videoTrack={v as unknown as MediaStreamTrack} label="Rae" />);
    const onAttach = play.mock.calls.length;

    comeBack("pageshow");
    expect(play.mock.calls.length).toBe(onAttach + 1);
  });

  // Going INTO the background fires the same event. A play() while hidden can
  // be refused on mobile, and would spend the retry a user gesture is good for.
  it("is left alone while the page is still hidden", () => {
    const v = track("video");
    render(<VideoTile stream={stream(v)} videoTrack={v as unknown as MediaStreamTrack} label="Rae" />);
    const onAttach = play.mock.calls.length;

    visibility = "hidden";
    comeBack("visibilitychange");
    expect(play.mock.calls.length).toBe(onAttach);
  });

  // A tile with nothing attached is somebody whose camera never arrived, not
  // one that stopped; playing it would do nothing and log an error.
  it("is left alone when it has no stream", () => {
    render(<VideoTile stream={null} videoTrack={null} label="Rae" />);
    expect(play).not.toHaveBeenCalled();

    comeBack("visibilitychange");
    expect(play).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const v = track("video");
    const view = render(<VideoTile stream={stream(v)} videoTrack={v as unknown as MediaStreamTrack} label="Rae" />);
    view.unmount();
    const after = play.mock.calls.length;

    comeBack("visibilitychange");
    expect(play.mock.calls.length).toBe(after);
  });
});

describe("a voice, after the page was hidden", () => {
  it("is played again when the page becomes visible", () => {
    const a = track("audio");
    render(<PeerAudio stream={stream(a)} audioTrack={a as unknown as MediaStreamTrack} />);
    const onAttach = play.mock.calls.length;
    expect(onAttach).toBeGreaterThan(0);

    comeBack("visibilitychange");
    expect(play.mock.calls.length).toBe(onAttach + 1);
  });

  it("is played again when the page is restored", () => {
    const a = track("audio");
    render(<PeerAudio stream={stream(a)} audioTrack={a as unknown as MediaStreamTrack} />);
    const onAttach = play.mock.calls.length;

    comeBack("pageshow");
    expect(play.mock.calls.length).toBe(onAttach + 1);
  });
});
