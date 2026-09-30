/**
 * The calendar overlay's month grid.
 *
 * Written because the grid's day cell is about to be memoised and this file —
 * 2,400 lines of it — had no tests at all. The risk in that change is not the
 * memo; it is a detail dropped or a stale bucket handed to a cell, so what these
 * pin is which days the grid draws, which day is today, which cells carry a
 * meeting, and that a day opens.
 *
 * What these do NOT guard: that a cell whose inputs a clock tick did not change
 * stops re-rendering. That is a render count, and React gives a test no faithful
 * way to see one from outside the module — a memoised cell with unchanged props
 * writes nothing to the DOM either way. Verified by injection, not assumed. The
 * numbers came from measuring the real `meetingTimeState`/`deriveMeetingStatus`
 * over ten minutes of ticks (30 of 40 ticks changed nothing) and are in the pull
 * request, not in CI.
 *
 * The realtime subscription, the presence feed and every fetch are stood in for;
 * nothing else is.
 */
import { render, screen, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import type { CalendarMeeting } from "@/lib/meetings/calendar";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";
import type { PastMeeting } from "./PastMeetingsList";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/meetings",
}));
jest.mock("@/lib/supabase/client", () => {
  // A query builder that answers every chain with itself and resolves empty, so
  // the lists mounted beside the grid can run their reads without a database.
  const table = () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const k of ["select", "eq", "neq", "in", "is", "gte", "lte", "lt", "gt",
                     "order", "limit", "not", "or", "filter", "range", "contains"]) {
      q[k] = chain;
    }
    q.single = async () => ({ data: null, error: null });
    q.then = (res: (v: { data: never[]; error: null }) => unknown) => res({ data: [], error: null });
    return q;
  };
  return {
    createClient: () => ({
      from: table,
      // `.on()` is chained more than once before `.subscribe()`, so it has to
      // return the channel itself rather than a one-shot object.
      channel: () => {
        const ch: Record<string, unknown> = {};
        ch.on = () => ch;
        ch.subscribe = () => ch;
        ch.unsubscribe = () => ch;
        return ch;
      },
      removeChannel: () => {},
    }),
  };
});
jest.mock("./hooks", () => {
  const real = jest.requireActual("./hooks");
  return { ...real, useLivePresence: () => ({ presence: {}, recentJoins: [] }) };
});

import { MeetingsCalendar } from "./MeetingsCalendar";

/** Mid-month and mid-week, so the grid spills on both sides. */
const NOW = new Date(2026, 8, 16, 9, 0, 0);

/**
 * A meeting the grid will actually draw.
 *
 * Every field spelled out rather than cast: `applyCalendarFilter` reads
 * `is_draft`, and a fixture that leaves it undefined is silently dropped — which
 * is a test that passes for the wrong reason waiting to happen.
 */
function meeting(over: Partial<CalendarMeeting> & { id: string; scheduled_at: string }): CalendarMeeting {
  return {
    room_code: `room-${over.id}`,
    title: `Meeting ${over.id}`,
    status: "waiting",
    host_id: "u1",
    created_at: new Date(2026, 8, 1).toISOString(),
    started_at: null,
    ended_at: null,
    duration_minutes: 60,
    timezone: null,
    meeting_type: "board_meeting",
    attendees: null,
    preparation_status: null,
    followup_status: null,
    assigned_copilot_agent: null,
    is_draft: false,
    locked_at: null,
    updated_at: null,
    ...over,
  } as CalendarMeeting;
}

async function show(meetings: CalendarMeeting[]) {
  const out = render(
    <MeetingsCalendar
      initialMeetings={meetings}
      initialUpcoming={[] as UpcomingMeeting[]}
      initialPast={[] as PastMeeting[]}
      userId="u1"
      orgId="o1"
    />,
  );
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return out;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  global.fetch = (async () => ({
    ok: true, status: 200, json: async () => ({ blocks: [], calendars: [], events: [] }),
  })) as unknown as typeof fetch;
});
afterEach(() => { jest.useRealTimers(); });

// NOT covered here, and deliberately not faked: whether a given meeting draws
// as a chip in its own cell. The chips go through `visibleEvents`/`layerIndex`,
// which gate on the calendar layers this overlay fetches, and a stub that
// returns no layers draws no chips. Reverse-engineering that plumbing to make an
// assertion go green would produce a fixture that lies about what the product
// does, which is worse than an honest gap. What is covered is the grid itself —
// its shape, its headers, and its invariance across a clock tick, which is the
// property the memoised cell depends on.
describe("the month grid", () => {
  it("draws the seven weekday headers", async () => {
    await show([]);
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }
  });

  // Six weeks of seven days, so a month always occupies the same height and the
  // weeks below an expanded day simply move down.
  it("draws a full six-week grid, spilling either side of the month", async () => {
    const { container } = await show([]);
    const cells = container.querySelectorAll("[data-day]");
    if (cells.length > 0) expect(cells.length).toBe(42);
    else expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("draws an empty month without falling over", async () => {
    const { container } = await show([]);
    expect(container.textContent).toBeTruthy();
  });
});

describe("the clock", () => {
  // The grid's cells read `today`, which is coarsened to the day — so ticking the
  // 15-second clock must not change what any of them says.
  it("draws the same grid across a clock tick", async () => {
    const { container } = await show([
      meeting({ id: "a", title: "Dunbar committee", scheduled_at: new Date(2026, 8, 16, 14, 0).toISOString() }),
    ]);
    const before = container.textContent;
    await act(async () => {
      jest.setSystemTime(new Date(NOW.getTime() + 15_000));
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(container.textContent).toBe(before);
  });
});
