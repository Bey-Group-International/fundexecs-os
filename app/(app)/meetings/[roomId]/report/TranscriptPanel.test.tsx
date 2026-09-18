/**
 * The transcript beside the recording.
 *
 * Two defects, and they are the same defect pointed in opposite directions:
 * the panel knew things it never told anybody.
 *
 * Search filtered turns down to the ones containing the query and stopped —
 * never showing where the match was, never counting them, and throwing away
 * the conversation around each hit, which is the part that makes a hit mean
 * anything.
 *
 * And the link to the player ran one way. A line could seek the recording; the
 * recording reported its position to nobody, so watching a meeting back meant
 * scrolling this by hand to keep up.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TranscriptPanel } from "./TranscriptPanel";
import type { TranscriptCue } from "@/lib/meetings/transcript-cues";

const cue = (speaker: string, atMs: number, ...paragraphs: string[]): TranscriptCue => ({
  speaker, atMs, uncertain: false, overlapped: false, paragraphs,
});

const CUES: TranscriptCue[] = [
  cue("Alina", 0, "What did we land on for the valuation?"),
  cue("Rae", 5_000, "Forty, roughly.", "The valuation work is not finished."),
  cue("Alina", 12_000, "Understood."),
];

function setup(props: Partial<React.ComponentProps<typeof TranscriptPanel>> = {}) {
  const onSeek = jest.fn();
  const view = render(
    <TranscriptPanel transcript="" cues={CUES} onSeek={onSeek} {...props} />,
  );
  return { onSeek, user: userEvent.setup(), view };
}

/** The panel is collapsed until asked for. */
async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Transcript/ }));
}

beforeAll(() => {
  // jsdom has no layout, so this exists only to be called.
  Element.prototype.scrollIntoView = jest.fn();
});

describe("search", () => {
  it("marks every match where it sits", async () => {
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByLabelText("Search the transcript"), "valuation");

    const marks = screen.getAllByText("valuation", { selector: "mark" });
    expect(marks).toHaveLength(2);
  });

  it("counts them", async () => {
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByLabelText("Search the transcript"), "valuation");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
  });

  // The defect this replaced: filtering deleted the turns around a hit, and
  // the line before a hit is usually the question it answers.
  it("keeps the conversation around a hit", async () => {
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByLabelText("Search the transcript"), "valuation");
    // "Understood." contains no match and must still be on screen.
    expect(screen.getByText("Understood.")).toBeInTheDocument();
  });

  it("steps between matches, and says which one it is on", async () => {
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByLabelText("Search the transcript"), "valuation");

    await user.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    // Wrapping: a find box that stops responding reads as broken.
    await user.click(screen.getByRole("button", { name: "Next match" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
    await user.click(screen.getByRole("button", { name: "Previous match" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
  });

  it("steps with the keyboard, the way every find box does", async () => {
    const { user } = setup();
    await openPanel(user);
    const box = screen.getByLabelText("Search the transcript");
    await user.type(box, "valuation");
    await user.type(box, "{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    await user.type(box, "{Shift>}{Enter}{/Shift}");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2");
  });

  it("says so when nothing matches", async () => {
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByLabelText("Search the transcript"), "tungsten");
    expect(screen.getByRole("status")).toHaveTextContent("No matches");
    expect(screen.getByText(/Nothing in the transcript matches/)).toBeInTheDocument();
  });

  // Silence on a one-character query reads as "no matches", which is a
  // different and wrong answer.
  it("explains a query too short to run", async () => {
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByLabelText("Search the transcript"), "v");
    expect(screen.getByRole("status")).toHaveTextContent("Type at least 2 characters");
  });

  // The transcript is what somebody said. A renderer that drops a character
  // is rewriting it.
  it("leaves the unmatched text exactly as it was", async () => {
    const { user } = setup();
    await openPanel(user);
    await user.type(screen.getByLabelText("Search the transcript"), "valuation");
    // Read off the paragraph, not off the fragment: the point is that the
    // pieces reassemble into the sentence somebody actually said.
    const paragraph = screen.getAllByText("valuation", { selector: "mark" })[0].closest("p");
    expect(paragraph?.textContent).toBe("What did we land on for the valuation?");
  });
});

describe("following the recording", () => {
  it("marks the line being spoken", async () => {
    const { user } = setup({ currentMs: 7_000 });
    await openPanel(user);
    const current = screen.getByRole("listitem", { current: true });
    expect(within(current).getByText("Forty, roughly.")).toBeInTheDocument();
  });

  it("moves the mark as the recording plays", async () => {
    const { user, view } = setup({ currentMs: 7_000 });
    await openPanel(user);
    view.rerender(<TranscriptPanel transcript="" cues={CUES} onSeek={jest.fn()} currentMs={13_000} />);
    const current = screen.getByRole("listitem", { current: true });
    expect(within(current).getByText("Understood.")).toBeInTheDocument();
  });

  // A turn owns the time from when it starts until the next one does, so a
  // pause mid-sentence still belongs to the person speaking.
  it("keeps the mark on a speaker through a pause", async () => {
    const { user } = setup({ currentMs: 11_900 });
    await openPanel(user);
    const current = screen.getByRole("listitem", { current: true });
    expect(within(current).getByText("Forty, roughly.")).toBeInTheDocument();
  });

  it("marks nothing before the first word", async () => {
    const { user } = setup({ cues: [cue("Rae", 3_000, "Shall we start?")], currentMs: 1_000 });
    await openPanel(user);
    expect(screen.queryByRole("listitem", { current: true })).not.toBeInTheDocument();
  });

  it("marks nothing when there is no player to follow", async () => {
    const { user } = setup({ currentMs: undefined });
    await openPanel(user);
    expect(screen.queryByRole("listitem", { current: true })).not.toBeInTheDocument();
  });

  // A meeting recorded from halfway has every earlier turn clamped to zero.
  // Marking one of those as "now" would be inventing a fact.
  it("declines to follow a transcript whose clock is mostly clamped", async () => {
    const clamped = [cue("A", 0, "one"), cue("B", 0, "two"), cue("C", 0, "three"), cue("D", 9_000, "four")];
    const { user } = setup({ cues: clamped, currentMs: 9_500 });
    await openPanel(user);
    expect(screen.queryByRole("listitem", { current: true })).not.toBeInTheDocument();
  });
});

describe("driving the recording", () => {
  // The direction that already worked, kept working.
  it("seeks to a turn when its time is clicked", async () => {
    const { onSeek, user } = setup();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "0:05" }));
    expect(onSeek).toHaveBeenCalledWith(5_000);
  });
});
