jest.mock("@/app/(app)/meetings/[roomId]/report/RecordingPlayer", () => ({ RecordingPlayer: () => null }));
import { activeCueIndex } from "./ClipView";
import type { TranscriptCue } from "@/lib/meetings/transcript-cues";

const cue = (atMs: number) => ({ atMs }) as unknown as TranscriptCue;

it("finds the line being spoken", () => {
  const cues = [cue(1000), cue(5000), cue(9000)];
  expect(activeCueIndex(cues, 0)).toBe(-1);
  expect(activeCueIndex(cues, 1000)).toBe(0);
  expect(activeCueIndex(cues, 4800)).toBe(1); // a quarter-second early counts
  expect(activeCueIndex(cues, 20_000)).toBe(2);
  expect(activeCueIndex([], 5000)).toBe(-1);
});

import { render, screen } from "@testing-library/react";
import { ClipView } from "./ClipView";

function view(allowDownload: boolean) {
  return render(
    <ClipView
      token="tok"
      title="Pricing"
      meetingTitle="Quarterly call"
      meetingId="m1"
      recordingId="r1"
      startMs={61_000}
      endMs={90_000}
      baseMs={58_000}
      expiresAt="2026-11-13T00:00:00Z"
      allowDownload={allowDownload}
      cues={[{ speaker: "Ann", atMs: 3_000, uncertain: false, overlapped: false, paragraphs: ["Inside."] }]}
    />,
  );
}

it("shows the recording's times while the cues run on the clip's clock", () => {
  view(false);
  expect(screen.getByText(/1:01–1:30/)).toBeInTheDocument();
  // A cue 3s into the clip, which starts 58s into the recording, reads 1:01.
  expect(screen.getByRole("button", { name: /1:01\s*Ann: Inside\./ })).toBeInTheDocument();
});

it("offers a download only when the link allows one", () => {
  const { unmount } = view(false);
  expect(screen.queryByRole("link", { name: "Download clip" })).toBeNull();
  unmount();
  view(true);
  expect(screen.getByRole("link", { name: "Download clip" })).toHaveAttribute("href", "/api/clip/tok/stream?download=1");
});
