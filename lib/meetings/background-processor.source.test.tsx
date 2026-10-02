// A camera that stops should stop the loop drawing over it.
//
// A stopped MediaStreamTrack leaves the hidden <video> holding its last frame
// with a readyState that still says it has data, so nothing about the loop
// notices: it keeps segmenting one still picture at 24fps, on the GPU, forever.
//
// That is not an exotic case. It happens on every join — the green room's
// preview processor outlives by a few hundred milliseconds the tracks the room
// stops when it takes over — and again whenever somebody unplugs a webcam mid
// call.
//
// Written as .tsx for the jsdom project: the processor needs a document, and the
// browser pieces it reaches for (canvas 2d contexts, captureStream, video
// playback, MediaStream) are stubbed here rather than mocked around, so the test
// drives the real class through the real sequence.

import { BackgroundProcessor } from "./background-processor";

/** A camera track, with the `ended` event the processor now listens for. */
class FakeTrack extends EventTarget {
  kind = "video";
  readyState = "live";
  enabled = true;
  stop = jest.fn();
  getSettings() { return { width: 640, height: 480 }; }
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

function fakeCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      save() {}, restore() {}, clearRect() {}, drawImage() {}, fillRect() {},
      putImageData() {}, createImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
      filter: "none", globalCompositeOperation: "source-over", fillStyle: "",
    }),
    captureStream: () => ({
      getVideoTracks: () => [new FakeTrack()],
      getTracks: () => [new FakeTrack()],
    }),
  };
  return canvas as unknown as HTMLCanvasElement;
}

function fakeVideo() {
  // readyState 0 keeps drawFrame returning before it touches a canvas: this
  // test is about whether the loop runs at all, not about what it paints.
  return { playsInline: false, muted: false, srcObject: null, readyState: 0, videoWidth: 0, videoHeight: 0, play: async () => {}, pause() {} } as unknown as HTMLVideoElement;
}

describe("a processor whose camera stops", () => {
  let frames: FrameRequestCallback[];
  let createElement: jest.SpyInstance;

  beforeEach(() => {
    frames = [];
    (globalThis as Record<string, unknown>).MediaStream = class {
      constructor(private readonly tracks: unknown[] = []) {}
      getTracks() { return this.tracks; }
      getVideoTracks() { return this.tracks; }
    };
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const real = document.createElement.bind(document);
    createElement = jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return fakeCanvas();
      if (tag === "video") return fakeVideo();
      return real(tag);
    });
  });

  afterEach(() => {
    createElement.mockRestore();
    jest.restoreAllMocks();
  });

  /** Run the frame that is pending, and report how many were scheduled by it. */
  function runPendingFrame(): number {
    const pending = frames.splice(0);
    pending.forEach((cb) => cb(performance.now()));
    return frames.length;
  }

  async function build(track: FakeTrack) {
    const processor = await BackgroundProcessor.create(track as unknown as MediaStreamTrack, {
      onSlowFrames: () => {},
      onUnavailable: () => {},
    });
    if (!processor) throw new Error("processor did not build");
    return processor;
  }

  it("stops drawing, and stays stopped", async () => {
    const track = new FakeTrack();
    const processor = await build(track);

    processor.setEffect({ kind: "blur", strength: "light" });
    expect(runPendingFrame()).toBe(1); // a live camera keeps the loop going

    track.end();
    expect(runPendingFrame()).toBe(0);

    // Neither of the two things that ordinarily restart it may restart it now:
    // there is no camera to composite, and a loop over a dead <video> is pure
    // cost with nothing at the end of it.
    processor.setPaused(false);
    expect(frames.length).toBe(0);

    processor.setEffect({ kind: "template", id: "neural" });
    expect(frames.length).toBe(0);

    processor.destroy();
  });

  it("never starts for a camera that had already stopped", async () => {
    const track = new FakeTrack();
    track.readyState = "ended";
    const processor = await build(track);

    processor.setEffect({ kind: "blur", strength: "heavy" });
    expect(frames.length).toBe(0);

    processor.destroy();
  });

  it("runs normally while the camera is live", async () => {
    const track = new FakeTrack();
    const processor = await build(track);

    processor.setEffect({ kind: "blur", strength: "light" });
    expect(runPendingFrame()).toBe(1);
    expect(runPendingFrame()).toBe(1);

    processor.destroy();
  });
});

/**
 * An uploaded background takes time to decode, and the choice behind it can be
 * stale before it lands.
 *
 * Somebody picks a photo, then switches to blur a beat later while the decode is
 * still running. The bitmap that arrives then is pixels nothing will ever draw.
 * Before this it reached the compositor anyway -- the token was only advanced
 * inside the decode, so a custom-then-blur switch left the stale decode looking
 * current -- and the compositor returned on "not a custom effect" without
 * closing it. Repeating the switch accumulated decoded bitmaps.
 *
 * Driven through the real class rather than asserted about its source, because
 * the race is the whole point and only the real sequence has it.
 */
describe("a custom background still decoding when the choice changes", () => {
  let createElement: jest.SpyInstance;
  /** Resolve the decode in flight, and the bitmap it will hand over. */
  let settle: ((bitmap: ImageBitmap) => void) | null;
  let closed: number;

  function nextBitmap(): ImageBitmap {
    return { width: 8, height: 8, close: () => { closed += 1; } } as unknown as ImageBitmap;
  }

  beforeEach(() => {
    settle = null;
    closed = 0;
    (globalThis as Record<string, unknown>).MediaStream = class {
      constructor(private readonly tracks: unknown[] = []) {}
      getTracks() { return this.tracks; }
      getVideoTracks() { return this.tracks; }
    };
    (globalThis as Record<string, unknown>).createImageBitmap = () =>
      new Promise<ImageBitmap>((resolve) => { settle = resolve; });
    jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const real = document.createElement.bind(document);
    createElement = jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return fakeCanvas();
      if (tag === "video") return fakeVideo();
      return real(tag);
    });
  });

  afterEach(() => {
    createElement.mockRestore();
    jest.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).createImageBitmap;
  });

  async function build() {
    const processor = await BackgroundProcessor.create(new FakeTrack() as unknown as MediaStreamTrack, {
      onSlowFrames: () => {},
      onUnavailable: () => {},
    });
    if (!processor) throw new Error("processor did not build");
    return processor;
  }

  /** Let the decode's `await` and the continuation after it run. */
  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("hands back the bitmap when the effect has moved on", async () => {
    const processor = await build();
    processor.setEffect({ kind: "custom", id: "u1" }, new Blob(["x"]));
    expect(settle).not.toBeNull();

    // The switch happens while the decode is still in flight.
    processor.setEffect({ kind: "blur", strength: "light" });
    settle!(nextBitmap());
    await drain();

    expect(closed).toBe(1);
    processor.destroy();
  });

  it("does not leak one per switch", async () => {
    const processor = await build();
    for (let i = 0; i < 4; i++) {
      processor.setEffect({ kind: "custom", id: `u${i}` }, new Blob(["x"]));
      processor.setEffect({ kind: "blur", strength: "light" });
      settle!(nextBitmap());
      await drain();
    }

    expect(closed).toBe(4);
    processor.destroy();
  });

  it("still keeps one that is current when it lands", async () => {
    const processor = await build();
    processor.setEffect({ kind: "custom", id: "u1" }, new Blob(["x"]));
    settle!(nextBitmap());
    await drain();

    expect(closed).toBe(0);
    processor.destroy();
    // Released with the processor, not before it.
    expect(closed).toBe(1);
  });

  it("hands back one that lands after the processor is gone", async () => {
    const processor = await build();
    processor.setEffect({ kind: "custom", id: "u1" }, new Blob(["x"]));
    processor.destroy();
    settle!(nextBitmap());
    await drain();

    expect(closed).toBe(1);
  });
});
