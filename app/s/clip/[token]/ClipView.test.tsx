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
