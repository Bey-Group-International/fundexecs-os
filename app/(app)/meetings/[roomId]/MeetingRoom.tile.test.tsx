/**
 * What a memoised video tile is still allowed to notice.
 *
 * VideoTile is memoised, which is worth doing: everything that re-renders the
 * room re-rendered every face in it — a transcript line landing, a chat message
 * arriving, somebody starting to talk (up to eight times a second, since the
 * analyser samples at 120ms) — on the same main thread that decodes the video.
 *
 * But memoising it nearly broke the room, and the near-miss is what this file
 * pins. `pc.ontrack`'s own comment says the room publishes a new peers Map even
 * when the stream object is unchanged, because a REPLACED track — a peer
 * starting a screen share, switching camera, turning a background on — is
 * swapped INTO that same MediaStream, and the tile can only learn about it by
 * looking again. A shallow memo sees an unchanged `stream` and drops the update,
 * and that peer's working camera stays behind the "Camera off" placeholder for
 * the rest of the call.
 *
 * A memo comparator cannot rescue this: both sides hold one object, so reading
 * the track from each gives the same answer — there is no record of what was
 * there before. The track is therefore a PROP, which is that record. These tests
 * exist so that nobody removes it as redundant.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoTile, videoTrackOf } from "./CallParts";

beforeAll(() => {
  // jsdom has no media pipeline; the component calls play() and catches.
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
});

interface FakeTrack {
  kind: string;
  id: string;
  enabled: boolean;
  readyState: string;
  addEventListener: () => void;
  removeEventListener: () => void;
}

const track = (id: string, kind = "video"): FakeTrack => ({
  kind,
  id,
  enabled: true,
  readyState: "live",
  addEventListener: () => {},
  removeEventListener: () => {},
});

/**
 * A MediaStream stand-in whose contents can be swapped in place, which is the
 * one thing about a real one that matters here.
 */
function fakeStream(...tracks: FakeTrack[]) {
  const list = [...tracks];
  return {
    getVideoTracks: () => list.filter((t) => t.kind === "video"),
    getAudioTracks: () => list.filter((t) => t.kind === "audio"),
    getTracks: () => list,
    swapVideo(next: FakeTrack | null) {
      const at = list.findIndex((t) => t.kind === "video");
      if (at >= 0) list.splice(at, 1);
      if (next) list.push(next);
    },
  };
}

type Stream = ReturnType<typeof fakeStream>;

/**
 * Stands in for the room: it re-renders on a state change while handing the tile
 * the SAME stream object, exactly as `setPeers` does after a track swap.
 */
function Room({ stream }: { stream: Stream }) {
  const [, rerender] = useState(0);
  return (
    <>
      <button onClick={() => rerender((n) => n + 1)}>republish</button>
      <VideoTile
        stream={stream as unknown as MediaStream}
        videoTrack={videoTrackOf(stream as unknown as MediaStream)}
        label="Rae Okafor"
      />
    </>
  );
}

describe("videoTrackOf", () => {
  it("finds the video track and ignores the audio one", () => {
    const s = fakeStream(track("a1", "audio"), track("v1")) as unknown as MediaStream;
    expect(videoTrackOf(s)?.id).toBe("v1");
  });

  it("answers null for a stream with no video and for no stream", () => {
    expect(videoTrackOf(fakeStream(track("a1", "audio")) as unknown as MediaStream)).toBeNull();
    expect(videoTrackOf(null)).toBeNull();
  });
});

describe("a memoised tile and a stream that changed underneath it", () => {
  it("shows the picture once a first video track lands in the same stream", async () => {
    // Tracks arrive one per transceiver. Audio lands first; the tile is showing
    // a placeholder when video turns up inside the stream it already has.
    const stream = fakeStream(track("a1", "audio"));
    render(<Room stream={stream} />);

    expect(screen.getByText("Camera off")).toBeInTheDocument();

    stream.swapVideo(track("v1"));
    await userEvent.click(screen.getByRole("button", { name: "republish" }));

    expect(screen.queryByText("Camera off")).not.toBeInTheDocument();
  });

  it("keeps showing the picture when a track is replaced in place", async () => {
    // A screen share or a camera switch. The stream object never changes.
    const stream = fakeStream(track("camera"));
    render(<Room stream={stream} />);
    expect(screen.queryByText("Camera off")).not.toBeInTheDocument();

    stream.swapVideo(track("screen-share"));
    await userEvent.click(screen.getByRole("button", { name: "republish" }));

    expect(screen.queryByText("Camera off")).not.toBeInTheDocument();
  });

  it("falls back to the placeholder when the video track goes away", async () => {
    const stream = fakeStream(track("v1"));
    render(<Room stream={stream} />);
    expect(screen.queryByText("Camera off")).not.toBeInTheDocument();

    stream.swapVideo(null);
    await userEvent.click(screen.getByRole("button", { name: "republish" }));

    expect(screen.getByText("Camera off")).toBeInTheDocument();
  });

  it("still says who it is while there is nothing to show", async () => {
    // The placeholder is not a blank rectangle: a name and an initial are the
    // whole point of it.
    const stream = fakeStream(track("a1", "audio"));
    render(<Room stream={stream} />);
    expect(screen.getAllByText(/Rae Okafor/).length).toBeGreaterThan(0);
    expect(screen.getByText("R")).toBeInTheDocument();
  });
});

describe("what the tile reports about a connection", () => {
  const streamWithVideo = () => fakeStream(track("v1")) as unknown as MediaStream;

  it("outranks 'camera off' with a reconnecting notice", () => {
    render(
      <VideoTile
        stream={null}
        videoTrack={null}
        label="Rae Okafor"
        status="reconnecting"
      />,
    );
    // "Reconnecting" is the only notice that says the picture is not coming
    // back by itself, so it is the one that gets said.
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
    expect(screen.queryByText("Camera off")).not.toBeInTheDocument();
  });

  it("distinguishes a paused video from a camera somebody switched off", () => {
    // The two look identical on screen — a frozen or blank rectangle — and the
    // difference is whether the person chose it. A remote peer whose video the
    // network pulled says so, and says it was not their doing.
    const { rerender } = render(
      <VideoTile
        stream={streamWithVideo()}
        videoTrack={track("v1") as unknown as MediaStreamTrack}
        label="Rae Okafor"
        camOn
        videoPaused
      />,
    );
    expect(screen.getByText("Video paused — weak connection")).toBeInTheDocument();
    expect(screen.queryByText("Camera off")).not.toBeInTheDocument();

    rerender(
      <VideoTile stream={null} videoTrack={null} label="Rae Okafor" camOn={false} />,
    );
    expect(screen.getByText("Camera off")).toBeInTheDocument();
    expect(screen.queryByText("Video paused — weak connection")).not.toBeInTheDocument();
  });

  it("shows a local picture the far end is not getting", () => {
    // The local tile is the one case where the video plays AND the pause notice
    // belongs: the member can see themselves while the budget has stopped
    // sending them. The version this replaced disabled the local track outright,
    // so a bad ten seconds turned somebody's own picture off.
    render(
      <VideoTile
        stream={streamWithVideo()}
        videoTrack={track("v1") as unknown as MediaStreamTrack}
        label="Rae Okafor"
        isLocal
        videoPaused
      />,
    );
    expect(screen.getByText("Video paused")).toBeInTheDocument();
    expect(screen.queryByText("Camera off")).not.toBeInTheDocument();
  });
});
