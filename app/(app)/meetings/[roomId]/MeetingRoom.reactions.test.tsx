/**
 * The reaction ticker.
 *
 * Rendered directly, as HostExitControl and CopilotSidebar are and for the
 * reason those tests give: reaching it through MeetingRoom means entering a
 * room, which opens a camera, an ICE negotiation and a Realtime channel.
 *
 * What is pinned here is the half of the defect that lives in the markup — a
 * reaction being readable at all when the sender's tile is not on screen, and
 * being announced to somebody who cannot see the picture. The ordering and the
 * bound are in lib/meetings/reactions.test.ts.
 */
import { render, screen, within } from "@testing-library/react";
import { ReactionTicker } from "./MeetingRoom";
import { type ActiveReaction } from "@/lib/meetings/reactions";

const entry = (over: Partial<ActiveReaction> = {}): ActiveReaction => ({
  id: "p2", displayName: "Rae Okafor", emoji: "👍", ...over,
});

describe("ReactionTicker", () => {
  // The defect: reactions lived only on the sender's tile, which is off-screen
  // in speaker layout and below the fold in a large grid — the argument
  // hands.ts makes, acted on for hands and not for reactions.
  it("names who reacted, away from their tile", () => {
    render(<ReactionTicker entries={[entry()]} />);
    expect(screen.getByText("Rae Okafor")).toBeInTheDocument();
  });

  it("shows one row per person reacting, in the order given", () => {
    render(<ReactionTicker entries={[entry({ id: "a", displayName: "Alina" }), entry({ id: "b", displayName: "Sam" })]} />);
    const rows = within(screen.getByRole("status")).getAllByText(/ reacted /);
    expect(rows.map((r) => r.textContent)).toEqual(["Alina reacted 👍", "Sam reacted 👍"]);
  });

  // The other half: the tile overlay is a bare emoji with no text, so there was
  // nothing for a screen reader to announce and reactions did not exist at all
  // for anyone not looking at the picture.
  it("announces itself politely, without stealing focus", () => {
    render(<ReactionTicker entries={[entry()]} />);
    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
  });

  it("gives a screen reader a sentence rather than a bare emoji", () => {
    render(<ReactionTicker entries={[entry()]} />);
    expect(screen.getByText("Rae Okafor reacted 👍")).toBeInTheDocument();
  });

  // The emoji and the visible name are both decorative: the sr-only sentence
  // already carries them, and announcing all three reads the reaction twice.
  it("does not read the same reaction twice", () => {
    const { container } = render(<ReactionTicker entries={[entry()]} />);
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBe(2);
    expect([...hidden].map((n) => n.textContent)).toEqual(["👍", "Rae Okafor"]);
  });

  // It sits over the stage, so it must never swallow a click meant for a tile
  // or for the control bar underneath.
  it("takes no pointer events", () => {
    render(<ReactionTicker entries={[entry()]} />);
    expect(screen.getByRole("status").className).toContain("pointer-events-none");
  });

  it("renders nothing to read when nobody is reacting", () => {
    render(<ReactionTicker entries={[]} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
