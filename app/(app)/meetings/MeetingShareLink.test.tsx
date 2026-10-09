/**
 * The share box, and which link it actually hands out.
 *
 * The defect these pin: the reminder emails hand out a synced meeting's own
 * conferencing link (meetingJoinUrl), and this box always handed out the
 * FundExecs room — so for a meeting that happens on Zoom, the host's "Copy
 * link" sent a guest to an empty room while the email for the same meeting
 * pointed at the right one. One meeting, one link, whichever surface it
 * leaves by.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeetingShareLink } from "./MeetingShareLink";

const written: string[] = [];

beforeEach(() => {
  written.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t: string) => { written.push(t); } },
  });
});

describe("which link the box hands out", () => {
  it("shows and copies the room link for a meeting held in the FundExecs room", async () => {
    render(<MeetingShareLink roomCode="abc-def-12" title="Board" />);
    const copy = await screen.findByRole("button", { name: /copy link/i });
    expect(screen.getByTitle(`${window.location.origin}/meeting-invite/abc-def-12`)).toBeInTheDocument();
    await userEvent.click(copy);
    await waitFor(() => expect(written).toEqual([`${window.location.origin}/meeting-invite/abc-def-12`]));
  });

  it("shows and copies the meeting's own conferencing link when a synced meeting has one", async () => {
    render(
      <MeetingShareLink roomCode="abc-def-12" title="Board" meetingUrl="https://zoom.us/j/123" />,
    );
    const copy = await screen.findByRole("button", { name: /copy link/i });
    expect(screen.getByTitle("https://zoom.us/j/123")).toBeInTheDocument();
    await userEvent.click(copy);
    await waitFor(() => expect(written).toEqual(["https://zoom.us/j/123"]));
  });

  it("writes the same link into the invite text, so no guest holds two", async () => {
    render(
      <MeetingShareLink roomCode="abc-def-12" title="Board" meetingUrl="https://zoom.us/j/123" />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /copy invite/i }));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toContain("Join: https://zoom.us/j/123");
    expect(written[0]).not.toContain("meeting-invite");
  });

  it("ignores an external link that is not a real http(s) one", async () => {
    render(
      <MeetingShareLink roomCode="abc-def-12" title="Board" meetingUrl="zoommtg://zoom.us/join" />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /copy link/i }));
    await waitFor(() => expect(written).toEqual([`${window.location.origin}/meeting-invite/abc-def-12`]));
  });
});
