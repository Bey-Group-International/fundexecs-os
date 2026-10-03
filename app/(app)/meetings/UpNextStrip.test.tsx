import { render, screen } from "@testing-library/react";
import { UpNextStrip } from "./UpNextStrip";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

const NOW = new Date(2026, 9, 3, 10, 0).getTime();
const meeting = (over: Partial<UpcomingMeeting> = {}) =>
  ({
    id: "m1",
    room_code: "abc-defg-hij",
    title: "Series B sync",
    status: "waiting",
    scheduled_at: new Date(2026, 9, 3, 10, 12).toISOString(),
    duration_minutes: 30,
    ...over,
  }) as UpcomingMeeting;

describe("UpNextStrip", () => {
  it("offers the next meeting with a countdown and Join", () => {
    render(<UpNextStrip next={{ meeting: meeting(), live: false, inRoom: { count: 0, names: [] } }} now={NOW} />);
    expect(screen.getByRole("region", { name: "Up next" })).toHaveTextContent("Series B sync");
    expect(screen.getByText(/in 12 min/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", "/meetings/abc-defg-hij");
  });

  it("says who is already in a live room", () => {
    render(
      <UpNextStrip
        next={{ meeting: meeting(), live: true, inRoom: { count: 4, names: ["Rae", "Ana", "Tom", "Li"] } }}
        now={NOW}
      />,
    );
    expect(screen.getByRole("region", { name: "Live now" })).toHaveTextContent("4 in the room · Rae, Ana, Tom +1");
    expect(screen.getByRole("link", { name: "Join now" })).toBeTruthy();
  });

  it("draws nothing when there is nothing to join today", () => {
    const { container } = render(<UpNextStrip next={null} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});
