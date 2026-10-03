/**
 * The media panel's two ways in from outside it: a "play from" chip on the
 * overview, and a shared link's `?t=`.
 *
 * The player is loaded lazily, so on arrival there is no handle to seek yet.
 * The panel must keep the jump until one attaches, or a shared link opens the
 * recording at the start.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import type { RecordingPlayerHandle } from "./RecordingPlayer";
import { SEEK_EVENT } from "@/lib/meetings/report-moments";

const seekTo = jest.fn();
let attach: ((h: RecordingPlayerHandle | null) => void) | null = null;

jest.mock("./RecordingPanel", () => ({
  RecordingPanel: ({ playerRef }: { playerRef: (h: RecordingPlayerHandle | null) => void }) => {
    attach = playerRef;
    return null;
  },
}));
jest.mock("./TranscriptPanel", () => ({ TranscriptPanel: () => null }));

import { ReportMedia } from "./ReportMedia";

const RECORDINGS = [
  { id: "r1", status: "complete", deleted_at: null, started_at: "2026-09-23T14:00:00.000Z", duration_seconds: 600 },
] as never;

beforeEach(() => {
  seekTo.mockReset();
  attach = null;
  window.history.replaceState(null, "", "/meetings/abc/report");
});

it("follows a shared link once the player has loaded", async () => {
  window.history.replaceState(null, "", "/meetings/abc/report?t=90#recording");
  render(<ReportMedia meetingId="m1" recordings={RECORDINGS} cueRows={[]} transcript={null} />);
  // No player yet: nothing to call, and nothing lost.
  expect(seekTo).not.toHaveBeenCalled();

  act(() => attach!({ seekTo }));
  expect(seekTo).toHaveBeenCalledWith(90_000, { play: true });
});

it("plays from a moment a chip asks for", () => {
  render(<ReportMedia meetingId="m1" recordings={RECORDINGS} cueRows={[]} transcript={null} />);
  act(() => attach!({ seekTo }));

  act(() => {
    window.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: { ms: 190_000, play: true } }));
  });
  expect(seekTo).toHaveBeenCalledWith(190_000, { play: true });
});

it("asks for nothing on an ordinary visit", () => {
  render(<ReportMedia meetingId="m1" recordings={RECORDINGS} cueRows={[]} transcript={null} />);
  act(() => attach!({ seekTo }));
  expect(seekTo).not.toHaveBeenCalled();
});
