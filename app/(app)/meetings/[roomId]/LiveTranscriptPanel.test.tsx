import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LiveTranscriptPanel } from "./LiveTranscriptPanel";

const line = (id: string, speakerId: string, speaker: string, text: string, ts: number, final = true) => ({
  id, speakerId, speaker, text, ts, final, isLocal: speakerId === "me",
});

const LINES = [
  line("1", "a", "Ana", "The valuation is", 1_000),
  line("2", "a", "Ana", "about forty million.", 3_000),
  line("3", "b", "Ben", "Valuation feels high.", 5_000),
  line("4", "me", "Me", "Let's revisit the valuation.", 7_000),
];

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  (global as unknown as { CSS: unknown }).CSS = { escape: (s: string) => s };
});

function setup(extra: Partial<React.ComponentProps<typeof LiveTranscriptPanel>> = {}) {
  return render(
    <LiveTranscriptPanel lines={LINES} srStatus="active" meetingTitle="Dunbar call" colorFor={() => "#000"} {...extra} />,
  );
}

it("reads one speaker's fragments as one turn", () => {
  setup();
  expect(screen.getByText("The valuation is about forty million.")).toBeInTheDocument();
  expect(screen.getByText("You")).toBeInTheDocument();
});

it("finds every match, marks it, and steps between them", () => {
  const { container } = setup();
  fireEvent.change(screen.getByLabelText("Search transcript"), { target: { value: "valuation" } });
  expect(screen.getByText("1 of 3")).toBeInTheDocument();
  expect(container.querySelectorAll("mark")).toHaveLength(3);
  fireEvent.click(screen.getByLabelText("Next match"));
  expect(screen.getByText("2 of 3")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Previous match"));
  fireEvent.click(screen.getByLabelText("Previous match"));
  expect(screen.getByText("3 of 3")).toBeInTheDocument();
  expect(container.querySelector("mark[data-current]")!.textContent!.toLowerCase()).toBe("valuation");
});

it("says when nothing matches", () => {
  setup();
  fireEvent.change(screen.getByLabelText("Search transcript"), { target: { value: "zebra" } });
  expect(screen.getByText("No matches")).toBeInTheDocument();
});

it("copies the transcript as text", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  setup();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  });
  const text = writeText.mock.calls[0][0] as string;
  expect(text.split("\n")).toHaveLength(3);
  expect(text).toContain("Ana: The valuation is about forty million.");
  expect(await screen.findByText("Copied")).toBeInTheDocument();
});

it("bookmarks the moment, unless paused or a guest", async () => {
  const onBookmark = jest.fn().mockResolvedValue(true);
  const { rerender } = setup({ onBookmark });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /bookmark now/i }));
  });
  expect(onBookmark).toHaveBeenCalled();
  expect(await screen.findByText("Bookmarked")).toBeInTheDocument();
  rerender(<LiveTranscriptPanel lines={LINES} srStatus="active" meetingTitle="x" colorFor={() => "#000"} onBookmark={onBookmark} paused />);
  expect(screen.getByRole("button", { name: /bookmark now/i })).toBeDisabled();
  expect(screen.getByText(/notetaker is paused/)).toBeInTheDocument();
  rerender(<LiveTranscriptPanel lines={LINES} srStatus="active" meetingTitle="x" colorFor={() => "#000"} />);
  expect(screen.queryByRole("button", { name: /bookmark now/i })).toBeNull();
});

it("shows an empty state", () => {
  render(<LiveTranscriptPanel lines={[]} srStatus="active" meetingTitle="x" colorFor={() => "#000"} />);
  expect(screen.getByText(/Nothing transcribed yet/)).toBeInTheDocument();
  expect(within(document.body).getByRole("button", { name: "Copy" })).toBeDisabled();
});
