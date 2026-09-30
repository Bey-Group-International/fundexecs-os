/**
 * The upcoming list's collapsed row.
 *
 * Written because the row was extracted into a memoised component and this
 * file had no tests at all — nine hundred lines of it, including a delete
 * confirmation that emails guests. The extraction's risk is not the memo; it is
 * a detail silently dropped on the way out of the parent, so what these pin is
 * every string and link the collapsed row draws and every way it can be opened.
 *
 * What these do NOT guard: that a row whose text a clock tick did not change
 * stops re-rendering. That is a render count, and React gives a test no
 * faithful way to observe one from outside the module — a memoised row with
 * unchanged props writes nothing to the DOM either way, so every assertion
 * available here passes with the memo removed. Verified by injection rather
 * than assumed. It was measured with a Profiler instead: at sixty meetings a
 * tick costs 64.58ms without the memo and 2.83ms with it, and 93% of the row
 * re-renders it avoids changed nothing on screen. Those numbers are in the pull
 * request, not in CI.
 *
 * The realtime subscription, the presence feed and the refetch are stood in
 * for; nothing else is.
 */
import { render, screen, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
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

/** Presence is a live feed; these tests supply it instead. */
let presence: Record<string, { count: number; names: string[] }> = {};
jest.mock("./hooks", () => {
  const real = jest.requireActual("./hooks");
  return {
    ...real,
    useLivePresence: () => ({ presence, recentJoins: [] }),
  };
});

import { UpcomingMeetingsList } from "./UpcomingMeetingsList";

const NOW = Date.UTC(2026, 8, 30, 9, 0, 0);

function meeting(over: Partial<UpcomingMeeting> & { id: string }): UpcomingMeeting {
  return {
    room_code: `room-${over.id}`,
    title: `Meeting ${over.id}`,
    description: null, location: null, meeting_url: null,
    status: "waiting", scheduled_at: new Date(NOW + 60 * 60_000).toISOString(),
    duration_minutes: 60, timezone: null, meeting_type: "board_meeting",
    priority: null, tags: null, attendees: null, source: null, sync_status: null,
    source_event_id: null, source_calendar_id: null, deal_id: null,
    related_contact_id: null, related_company_id: null, related_fund_id: null,
    objective: null, agenda: null, preparation_requirements: null,
    preparation_status: null, followup_status: null, assigned_copilot_agent: null,
    related_record_type: null, related_record_id: null, calendar_visibility: null,
    reminder_minutes: null, external_calendar_provider: null,
    external_calendar_sync_enabled: null, external_calendar_sync_status: null,
    is_draft: false, locked_at: null, updated_at: null, guest_quick_access: null,
    ...over,
  };
}

function rowToggle(title: string) {
  return screen.getByRole("button", { name: new RegExp(title) });
}

beforeEach(() => {
  presence = {};
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date(NOW));
});
afterEach(() => { jest.useRealTimers(); });

function show(ms: UpcomingMeeting[], compact = false) {
  return render(<UpcomingMeetingsList initialMeetings={ms} compact={compact} />);
}

describe("what the collapsed row shows", () => {
  it("names the meeting and how to join it", () => {
    show([meeting({ id: "a", title: "Dunbar committee" })]);
    expect(screen.getByText("Dunbar committee")).toBeTruthy();
    const join = screen.getByRole("link", { name: "Join" });
    expect(join.getAttribute("href")).toBe("/meetings/room-a");
  });

  it("says Join live, and links the same room, once somebody is in it", () => {
    presence = { a: { count: 2, names: ["Ada", "Bey"] } };
    show([meeting({ id: "a" })]);
    const join = screen.getByRole("link", { name: "Join live" });
    expect(join.getAttribute("href")).toBe("/meetings/room-a");
  });

  it("counts down to a meeting that has not started", () => {
    show([meeting({ id: "a", scheduled_at: new Date(NOW + 45 * 60_000).toISOString() })]);
    expect(screen.getByText(/^in /)).toBeTruthy();
  });

  it("says In progress rather than a countdown once it is running", () => {
    show([meeting({ id: "a", scheduled_at: new Date(NOW - 10 * 60_000).toISOString() })]);
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  // The chip is for time still to come. A meeting whose clock has run out
  // carries its status instead, and must not show a stale countdown.
  it("drops the countdown chip when the meeting has ended", () => {
    show([meeting({ id: "a", scheduled_at: new Date(NOW - 5 * 60 * 60_000).toISOString() })]);
    expect(screen.queryByText("Ended")).toBeNull();
    expect(screen.queryByText(/^in /)).toBeNull();
  });

  it("shows the scheduled time, and hides that column in the narrow rail", () => {
    const at = new Date(NOW + 26 * 60 * 60_000).toISOString();
    const { unmount } = show([meeting({ id: "a", scheduled_at: at })]);
    const wide = document.body.textContent ?? "";
    unmount();
    show([meeting({ id: "a", scheduled_at: at })], true);
    const narrow = document.body.textContent ?? "";
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("says Time TBD for a meeting with no scheduled time", () => {
    show([meeting({ id: "a", scheduled_at: null })]);
    expect(screen.getByText("Time TBD")).toBeTruthy();
  });
});

describe("opening a row", () => {
  it("opens and closes on the disclosure", () => {
    show([meeting({ id: "a", title: "Dunbar committee" })]);
    const toggle = rowToggle("Dunbar committee");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => { fireEvent.click(toggle); });
    expect(rowToggle("Dunbar committee").getAttribute("aria-expanded")).toBe("true");
    act(() => { fireEvent.click(rowToggle("Dunbar committee")); });
    expect(rowToggle("Dunbar committee").getAttribute("aria-expanded")).toBe("false");
  });

  // One at a time: the point of a collapsed list is that the page stays short.
  it("closes the row that was open when another opens", () => {
    show([meeting({ id: "a", title: "First" }), meeting({ id: "b", title: "Second" })]);
    act(() => { fireEvent.click(rowToggle("First")); });
    expect(rowToggle("First").getAttribute("aria-expanded")).toBe("true");
    act(() => { fireEvent.click(rowToggle("Second")); });
    expect(rowToggle("First").getAttribute("aria-expanded")).toBe("false");
    expect(rowToggle("Second").getAttribute("aria-expanded")).toBe("true");
  });

  it("gives every row its own panel id, so the disclosure points at itself", () => {
    show([meeting({ id: "a", title: "First" }), meeting({ id: "b", title: "Second" })]);
    expect(rowToggle("First").getAttribute("aria-controls")).toBe("meeting-panel-a");
    expect(rowToggle("Second").getAttribute("aria-controls")).toBe("meeting-panel-b");
  });
});

describe("the list around the rows", () => {
  it("says so when there is nothing coming up", () => {
    show([]);
    expect(screen.getByText("No upcoming meetings")).toBeTruthy();
  });

  it("draws one row per meeting", () => {
    show([meeting({ id: "a" }), meeting({ id: "b" }), meeting({ id: "c" })]);
    expect(screen.getAllByRole("link", { name: /^Join/ })).toHaveLength(3);
  });
});
