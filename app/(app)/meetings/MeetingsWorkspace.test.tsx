/**
 * The meetings workspace: which tab a meeting lands in, what the one search
 * box filters, what "Needs action" lists, and what a click, a selection and the
 * week arrows do.
 *
 * The realtime feed, the presence feed and the refetch are stood in for, as in
 * UpcomingMeetingsList.test; the log below the Past tab is a marker.
 */
import { render, screen, act, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

let params = new URLSearchParams();
jest.mock("next/navigation", () => ({
  usePathname: () => "/meetings",
  useSearchParams: () => params,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}));
jest.mock("./upcoming-cache", () => ({
  fetchUpcoming: async () => null,
  forgetUpcoming: () => {},
  recentUpcoming: () => null,
}));
jest.mock("./hooks", () => {
  const real = jest.requireActual("./hooks");
  return { ...real, useLivePresence: () => ({ presence: {}, recentJoins: [] }) };
});
jest.mock("./MeetingLogs", () => ({
  MeetingLogs: ({ query }: { query?: string }) => <div data-testid="logs" data-query={query} />,
}));

import { MeetingsWorkspace } from "./MeetingsWorkspace";

// Thursday 2 October 2026, 09:00 local.
const NOW = new Date(2026, 9, 2, 9, 0).getTime();
const at = (days: number, hour = 10) => new Date(2026, 9, 2 + days, hour).toISOString();

function meeting(over: Partial<UpcomingMeeting> & { id: string }): UpcomingMeeting {
  return {
    room_code: `room-${over.id}`,
    title: `Meeting ${over.id}`,
    description: null, location: null, meeting_url: null,
    status: "waiting", scheduled_at: at(0),
    duration_minutes: 60, timezone: null, meeting_type: "board_meeting",
    priority: null, tags: null, attendees: null, source: null, sync_status: null,
    source_event_id: null, source_calendar_id: null, deal_id: null,
    related_contact_id: null, related_fund_id: null,
    objective: null, agenda: null, preparation_requirements: null,
    preparation_status: null, followup_status: null, assigned_copilot_agent: null,
    related_record_type: null, related_record_id: null, calendar_visibility: null,
    reminder_minutes: null, external_calendar_provider: null,
    external_calendar_sync_enabled: null, external_calendar_sync_status: null,
    is_draft: false, locked_at: null, updated_at: null, guest_quick_access: null,
    ...over,
  };
}

const MEETINGS = [
  meeting({ id: "lp", title: "LP Update", scheduled_at: at(0, 14), preparation_status: "prep_needed", attendees: [{ name: "Jane Doe", email: "jane@lp.test" }] }),
  meeting({ id: "ic", title: "Atlas IC", scheduled_at: at(1), priority: "high", preparation_status: "ready" }),
  meeting({ id: "far", title: "Annual meeting", scheduled_at: at(20), preparation_status: "ready" }),
];

const PENDING = [{ id: "old", room_code: "old-room", title: "Dunbar debrief", occurred_at: at(-3) }];

function show(ms = MEETINGS) {
  render(<MeetingsWorkspace initialUpcoming={ms} initialLogs={[]} initialPendingFollowUps={PENDING} />);
  act(() => { jest.advanceTimersByTime(0); });
}

beforeEach(() => {
  params = new URLSearchParams();
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date(NOW));
  window.history.replaceState(null, "", "/meetings");
});
afterEach(() => { jest.useRealTimers(); });

const tab = (name: RegExp) => screen.getByRole("tab", { name });
const panel = (id: string) => document.getElementById(`panel-${id}`)!;

describe("tabs", () => {
  it("opens on Today when there is something today, and counts each tab", () => {
    show();
    expect(tab(/^today/i)).toHaveAttribute("aria-selected", "true");
    expect(tab(/today/i)).toHaveTextContent("1");
    expect(tab(/upcoming/i)).toHaveTextContent("3");
    expect(within(panel("today")).getByText("LP Update")).toBeInTheDocument();
    expect(within(panel("today")).queryByText("Atlas IC")).toBeNull();
  });

  it("honours the tab in the address, and writes it there when changed", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    expect(tab(/upcoming/i)).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tab(/past/i));
    expect(window.location.search).toBe("?tab=past");
  });

  it("groups Upcoming by day", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    const list = panel("upcoming");
    expect(within(list).getByText("Today")).toBeInTheDocument();
    expect(within(list).getByText("Tomorrow")).toBeInTheDocument();
  });
});

describe("needs action", () => {
  it("lists prep due this week and a follow-up never sent, with a way to each", () => {
    params = new URLSearchParams("tab=needs");
    show();
    const list = panel("needs");
    expect(within(list).getByText("LP Update")).toBeInTheDocument();
    expect(within(list).getByText("Needs prep")).toBeInTheDocument();
    expect(within(list).queryByText("Annual meeting")).toBeNull();
    expect(within(list).getByText("Dunbar debrief")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: /review follow-up/i })).toHaveAttribute(
      "href",
      "/meetings/old-room/report#follow-up",
    );
    expect(tab(/needs action/i)).toHaveTextContent("2");
  });
});

describe("search", () => {
  it("filters every tab by title or person, and hands the query to the log", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    fireEvent.change(screen.getByRole("searchbox", { name: /search meetings/i }), { target: { value: "jane" } });
    const list = panel("upcoming");
    expect(within(list).getByText("LP Update")).toBeInTheDocument();
    expect(within(list).queryByText("Atlas IC")).toBeNull();
    expect(screen.getByTestId("logs")).toHaveAttribute("data-query", "jane");
  });

  it("says when nothing matches", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    fireEvent.change(screen.getByRole("searchbox", { name: /search meetings/i }), { target: { value: "zzz" } });
    expect(within(panel("upcoming")).getByText(/Nothing matches “zzz”/)).toBeInTheDocument();
  });
});

describe("rows", () => {
  it("shows the facts that matter beside the title", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    expect(within(panel("upcoming")).getByText("High priority")).toBeInTheDocument();
  });

  it("opens a preview beside the list, and closes it again", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Preview Atlas IC" }));
    const dialog = screen.getByRole("dialog", { name: /atlas ic preview/i });
    expect(within(dialog).getByRole("link", { name: "Join" })).toHaveAttribute("href", "/meetings/room-ic");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /atlas ic preview/i })).toBeNull();
  });
});

describe("bulk", () => {
  it("offers actions once meetings are selected, and asks before deleting", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    fireEvent.click(screen.getByLabelText("Select LP Update"));
    fireEvent.click(screen.getByLabelText("Select Atlas IC"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog", { name: /delete 2 meetings/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText("2 selected")).toBeNull();
  });
});

describe("weeks", () => {
  it("steps through Upcoming a week at a time", () => {
    params = new URLSearchParams("tab=upcoming");
    show();
    fireEvent.click(screen.getByRole("button", { name: "By week" }));
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(within(panel("upcoming")).queryByText("Annual meeting")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByText("Next week")).toBeInTheDocument();
    expect(within(panel("upcoming")).getByText(/Nothing next week/)).toBeInTheDocument();
  });
});
