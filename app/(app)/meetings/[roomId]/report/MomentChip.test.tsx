/**
 * The "play from" chip: it opens the recording tab and asks for its moment.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MomentChip } from "./MomentChip";
import { SEEK_EVENT, type SeekDetail } from "@/lib/meetings/report-moments";

afterEach(() => {
  window.location.hash = "";
});

it("asks to play from its moment and opens the recording tab", async () => {
  const heard: SeekDetail[] = [];
  const onSeek = (e: Event) => heard.push((e as CustomEvent<SeekDetail>).detail);
  window.addEventListener(SEEK_EVENT, onSeek);
  try {
    render(<MomentChip ms={754_000} what="this decision" />);
    await userEvent.click(screen.getByRole("button", { name: "Play from 12:34, where this decision was discussed" }));
    expect(heard).toEqual([{ ms: 754_000, play: true }]);
    expect(window.location.hash).toBe("#recording");
  } finally {
    window.removeEventListener(SEEK_EVENT, onSeek);
  }
});
