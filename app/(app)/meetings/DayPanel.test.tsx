/**
 * The day panel — what a member gets when they click a day in the month grid.
 *
 * The behaviour locked down here is the whole point of the panel: a month cell
 * can show about three chips, so clicking the day has to open everything on it,
 * grouped and collapsible, with each row opening into its own detail. The
 * detail's close button means "back to this day", never "out of the calendar" —
 * that is the case a member hits three times in a row on a busy Tuesday, and
 * the one a stray `onClose` would quietly break.
 */
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DayPanel } from "./MeetingsCalendar";
import type { CalendarBlock, CalendarMeeting } from "@/lib/meetings/calendar";
import type { CalendarLayer, ExternalEvent } from "@/lib/calendar/layers";
import type { MeetingDisplayStatus } from "@/lib/meetings/schedule";

const DAY = new Date(2026, 8, 17); // Thu Sep 17 2026, local

function localIso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

function mkMeeting(over: Partial<CalendarMeeting> = {}): CalendarMeeting {
  return {
    id: "m1",
    room_code: "abc",
    title: "IC review",
    status: "waiting",
    host_id: "u1",
    created_at: localIso(2026, 9, 1),
    started_at: null,
    ended_at: null,
    scheduled_at: localIso(2026, 9, 17, 9, 0),
    duration_minutes: 60,
    timezone: null,
    meeting_type: "deal_review",
    attendees: null,
    preparation_status: null,
    followup_status: null,
    assigned_copilot_agent: null,
    is_draft: false,
    locked_at: null,
    updated_at: null,
    description: null,
    location: null,
    meeting_url: null,
    objective: null,
    agenda: null,
    preparation_requirements: null,
    related_record_type: null,
    related_record_id: null,
    calendar_visibility: null,
    reminder_minutes: null,
    priority: null,
    tags: null,
    external_calendar_provider: null,
    external_calendar_sync_enabled: null,
    external_calendar_sync_status: null,
    ...over,
  };
}

const BLOCK: CalendarBlock = {
  id: "b1",
  title: "Deep work",
  startsAt: localIso(2026, 9, 17, 13, 0),
  endsAt: localIso(2026, 9, 17, 15, 0),
};

const LAYER: CalendarLayer = {
  id: "cal1",
  source: "google",
  name: "Work (Google)",
  color: "#3a7bc2",
  isVisible: true,
  blocksAvailability: true,
  isPrimary: true,
  canWrite: true,
  health: { state: "ok", message: null },
};

const EVENT: ExternalEvent = {
  id: "e1",
  calendarId: "cal1",
  title: "Board sync",
  location: "Room 4",
  link: "https://calendar.example/e1",
  startsAt: localIso(2026, 9, 17, 16, 0),
  endsAt: localIso(2026, 9, 17, 17, 0),
  isAllDay: false,
  isBusy: true,
};

type PanelProps = React.ComponentProps<typeof DayPanel>;

/**
 * The panel is controlled — its caller owns which row is open — so the harness
 * owns it too. Anything less would test a component that does not exist.
 */
function setup(over: Partial<PanelProps> = {}) {
  const spies = {
    onClose: jest.fn(),
    onNewMeeting: jest.fn(),
    onBlockTime: jest.fn(),
    onEditMeeting: jest.fn(),
    onClearBlock: jest.fn(),
    onOpenDayView: jest.fn(),
  };
  const base: PanelProps = {
    day: DAY,
    meetings: [mkMeeting(), mkMeeting({ id: "m2", title: "LP call", scheduled_at: localIso(2026, 9, 17, 11, 0) })],
    blocks: [BLOCK],
    externalEvents: [EVENT],
    layersById: new Map([[LAYER.id, LAYER]]),
    now: new Date(2026, 8, 17, 8, 0).getTime(),
    presence: {},
    statusOf: () => "Scheduled" as MeetingDisplayStatus,
    selectedKey: null,
    onSelectItem: () => {},
    ...spies,
    ...over,
  };

  function Host({ meetings }: { meetings: CalendarMeeting[] }) {
    const [selectedKey, setSelectedKey] = useState<string | null>(base.selectedKey);
    return <DayPanel {...base} meetings={meetings} selectedKey={selectedKey} onSelectItem={setSelectedKey} />;
  }

  const view = render(<Host meetings={base.meetings} />);
  return {
    ...spies,
    /** Swap the day's meetings the way a realtime refresh would. */
    setMeetings: (meetings: CalendarMeeting[]) => view.rerender(<Host meetings={meetings} />),
  };
}

describe("DayPanel — the list", () => {
  it("shows the day, a breakdown by kind, and every item on it", async () => {
    setup();
    expect(screen.getByRole("heading", { name: /Thursday, September 17, 2026/ })).toBeInTheDocument();
    expect(screen.getByText("2 meetings · 1 block · 1 event")).toBeInTheDocument();
    for (const title of ["IC review", "LP call", "Deep work", "Board sync"]) {
      expect(screen.getByRole("button", { name: new RegExp(title) })).toBeInTheDocument();
    }
  });

  it("groups into collapsible sections that hide their rows when closed", async () => {
    const user = userEvent.setup();
    setup();
    const meetingsHeader = screen.getByRole("button", { name: /Meetings\s*2/ });
    expect(meetingsHeader).toHaveAttribute("aria-expanded", "true");

    await user.click(meetingsHeader);

    expect(meetingsHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /IC review/ })).not.toBeInTheDocument();
    // Collapsing one group leaves the others alone.
    expect(screen.getByRole("button", { name: /Deep work/ })).toBeInTheDocument();
  });

  it("omits a section with nothing in it rather than showing a zero", () => {
    setup({ blocks: [], externalEvents: [] });
    expect(screen.queryByRole("button", { name: /Blocked time/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connected calendars/ })).not.toBeInTheDocument();
  });

  it("offers both create paths the day cell used to offer", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("button", { name: "New meeting" }));
    await user.click(screen.getByRole("button", { name: "Block time" }));
    expect(props.onNewMeeting).toHaveBeenCalledWith(DAY);
    expect(props.onBlockTime).toHaveBeenCalledWith(DAY);
  });

  it("says so plainly when the day is empty", () => {
    setup({ meetings: [], blocks: [], externalEvents: [] });
    expect(screen.getByText(/Nothing on this day yet/)).toBeInTheDocument();
  });
});

describe("DayPanel — drilling into a row and back", () => {
  it("opens a meeting's detail in place and returns to the full list on ×", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /IC review/ }));

    // The detail replaced the list: the other rows are gone, the actions are here.
    expect(screen.queryByRole("button", { name: /LP call/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Join/ })).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to the day's list" }));

    expect(screen.getByRole("button", { name: /IC review/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /LP call/ })).toBeInTheDocument();
    // Going back is not leaving: the panel itself stays open.
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("opens a block's detail, and clearing it drops back to the list", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /Deep work/ }));
    await user.click(screen.getByRole("button", { name: "Clear block" }));

    expect(props.onClearBlock).toHaveBeenCalledWith(expect.objectContaining({ id: "b1" }));
    expect(screen.getByRole("button", { name: /IC review/ })).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("opens an external event read-only, naming the calendar it belongs to", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /Board sync/ }));

    expect(screen.getByText("Work (Google)")).toBeInTheDocument();
    expect(screen.getByText("Room 4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open in Google Calendar/ })).toHaveAttribute(
      "href",
      "https://calendar.example/e1",
    );
    expect(screen.getByText(/edit it there, not here/)).toBeInTheDocument();
  });

  it("opens straight to the item the grid chip was clicked on", () => {
    setup({ selectedKey: "meeting:m2" });
    expect(screen.getByRole("heading", { name: "LP call" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /IC review/ })).not.toBeInTheDocument();
  });

  it("falls back to the list when the open item disappears under it", () => {
    const { setMeetings } = setup({ selectedKey: "meeting:m2", blocks: [], externalEvents: [] });
    expect(screen.getByRole("heading", { name: "LP call" })).toBeInTheDocument();

    // A refresh moved that meeting off this day. The detail must not keep
    // describing something the day no longer has.
    setMeetings([mkMeeting()]);

    expect(screen.queryByRole("heading", { name: "LP call" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /IC review/ })).toBeInTheDocument();
  });

  it("reopens the same row after backing out of it", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /IC review/ }));
    await user.click(screen.getByRole("button", { name: "Back to the day's list" }));
    await user.click(screen.getByRole("button", { name: /IC review/ }));

    expect(screen.getByRole("link", { name: /Join/ })).toBeInTheDocument();
  });
});

describe("DayPanel — Escape", () => {
  it("backs out one level at a time: detail to list, then list to closed", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("button", { name: /IC review/ }));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: /LP call/ })).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("DayPanel — section contents", () => {
  // Blocked time carries no status, presence or type, and is deliberately not
  // counted as a meeting anywhere else in the app. The grouping here is what
  // keeps that true on screen.
  it("keeps blocked time out of the meetings group", () => {
    setup();
    const meetingsGroup = screen.getByRole("button", { name: /Meetings\s*2/ }).parentElement as HTMLElement;
    expect(within(meetingsGroup).queryByText("Deep work")).not.toBeInTheDocument();
    expect(within(meetingsGroup).getByText("IC review")).toBeInTheDocument();
  });
});
