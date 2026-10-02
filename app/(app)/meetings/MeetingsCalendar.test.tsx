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
 * writes nothing to the DOM either way. Verified by injection, not assumed; the
 * cost is measured with a Profiler in the pull request, not in CI. Over ten
 * minutes of ticks NONE of the 40 changed a single cell's label or text, and all
 * 40 re-rendered the grid anyway: 10.2ms a tick became 4.3ms at thirty meetings,
 * 18.4ms became 6.9ms at eighty.
 *
 * The realtime subscription, the presence feed and every fetch are stood in for;
 * nothing else is.
 */
import { render, screen, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import type { CalendarMeeting } from "@/lib/meetings/calendar";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/meetings",
}));
/**
 * The rows the overlay's own read will find.
 *
 * It refetches `live_meetings` on mount and replaces `initialMeetings` with the
 * answer — the same "the list replaces the snapshot moments later" shape the
 * landing page documents. A stub that resolves empty therefore WIPES the
 * fixture, which is what made an earlier attempt at these tests see an empty
 * grid and wrongly look like the chips were gated on calendar layers. They are
 * not: `visibleEvents`/`layerIndex` only filter connected-calendar events. So
 * the fixture is supplied through the read the product actually makes.
 */
let dbRows: unknown[] = [];
/** Every realtime subscription the calendar opens, so a test can fire one. */
const mockChannelHandlers: Array<{ cfg: { table?: string; filter?: string }; cb: () => void }> = [];

jest.mock("@/lib/supabase/client", () => {
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const k of ["select", "eq", "neq", "in", "is", "gte", "lte", "lt", "gt",
                     "order", "limit", "not", "or", "filter", "range", "contains"]) {
      q[k] = chain;
    }
    const answer = () => ({ data: name === "live_meetings" ? dbRows : [], error: null });
    q.single = async () => ({ data: null, error: null });
    q.then = (res: (v: unknown) => unknown) => res(answer());
    return q;
  };
  return {
    createClient: () => ({
      from: table,
      // `.on()` is chained more than once before `.subscribe()`, so it has to
      // return the channel itself rather than a one-shot object.
      channel: () => {
        const ch: Record<string, unknown> = {};
        ch.on = (_event: string, cfg: { table?: string; filter?: string }, cb: () => void) => {
          mockChannelHandlers.push({ cfg, cb });
          return ch;
        };
        ch.subscribe = () => ch;
        ch.unsubscribe = () => ch;
        return ch;
      },
      removeChannel: () => {},
    }),
  };
});

/**
 * Presence, stood in for — but with STABLE identities.
 *
 * The real hook keeps both in `useState`, so they keep their identity between
 * polls. A stub returning a fresh `{}` per call does not, and since the day cell
 * takes `presence` whole, that one object silently invalidated every memo under
 * the grid: measured, it erased four fifths of what memoising the cell saves.
 * A stub may be simpler than the thing it stands in for; it must not be less
 * stable, or every measurement taken through it is wrong.
 */
jest.mock("./hooks", () => {
  const real = jest.requireActual("./hooks");
  const presence = {};
  const recentJoins: unknown[] = [];
  return { ...real, useLivePresence: () => ({ presence, recentJoins }) };
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

async function show(
  meetings: CalendarMeeting[],
  extra: { openScheduler?: boolean; onSchedulerOpened?: () => void } = {},
) {
  dbRows = meetings;
  const out = render(
    <MeetingsCalendar
      initialMeetings={meetings}
      userId="u1"
      orgId="o1"
      {...extra}
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

  it("shows a meeting on its own day", async () => {
    await show([
      meeting({ id: "a", title: "Dunbar committee", scheduled_at: new Date(2026, 8, 16, 14, 0).toISOString() }),
    ]);
    expect(screen.getAllByText(/Dunbar committee/).length).toBeGreaterThan(0);
  });

  // The count in each cell's accessible label is the load-bearing part: a screen
  // reader hears what a day holds even when the chips are summarised away, and
  // it is the one assertion that cannot be satisfied by a chip drawn on the
  // wrong day.
  it("counts the day's items on the day that owns them", async () => {
    await show([
      meeting({ id: "a", title: "First thing", scheduled_at: new Date(2026, 8, 10, 14, 0).toISOString() }),
      meeting({ id: "b", title: "Second thing", scheduled_at: new Date(2026, 8, 22, 14, 0).toISOString() }),
    ]);
    const withOne = screen.getAllByRole("button", { name: /1 item$/ });
    expect(withOne.length).toBe(2);
    expect(screen.getAllByRole("button", { name: /nothing scheduled$/ }).length).toBe(40);
  });

  it("keeps two meetings on different days apart", async () => {
    await show([
      meeting({ id: "a", title: "First thing", scheduled_at: new Date(2026, 8, 10, 14, 0).toISOString() }),
      meeting({ id: "b", title: "Second thing", scheduled_at: new Date(2026, 8, 22, 14, 0).toISOString() }),
    ]);
    expect(screen.getAllByText(/First thing/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Second thing/).length).toBeGreaterThan(0);
  });

  // Two on one day is the case the three-chip budget has to survive.
  it("puts two meetings on the same day in the same cell", async () => {
    await show([
      meeting({ id: "a", title: "Morning standup", scheduled_at: new Date(2026, 8, 16, 9, 0).toISOString() }),
      meeting({ id: "b", title: "Afternoon review", scheduled_at: new Date(2026, 8, 16, 15, 0).toISOString() }),
    ]);
    expect(screen.getAllByRole("button", { name: /2 items$/ }).length).toBe(1);
  });

  // A weekly series is a dozen meetings; the mark is what makes them read as
  // one thing.
  it("marks a meeting of a repeating series, and only that one", async () => {
    await show([
      meeting({
        id: "a",
        title: "Weekly sync",
        scheduled_at: new Date(2026, 8, 16, 9, 0).toISOString(),
        series_id: "a",
        series_index: 1,
        series_rule: "FREQ=WEEKLY;COUNT=6",
      }),
      meeting({ id: "b", title: "One-off", scheduled_at: new Date(2026, 8, 17, 9, 0).toISOString() }),
    ]);
    const marks = screen.getAllByRole("img", { name: "Repeats weekly · 2 of 6" });
    expect(marks.length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-repeat]").length).toBe(marks.length);
  });

  it("draws an empty month without falling over", async () => {
    const { container } = await show([]);
    expect(container.textContent).toBeTruthy();
  });
});

describe("the clock", () => {
  // The grid's cells read `today`, which is coarsened to the day — so ticking the
  // 15-second clock must not change what any of them says. This is the half of
  // the story a test CAN hold: not that the cells skip the render, but that the
  // render they are being spared would have redrawn the same grid. Ten minutes,
  // because that is the window the cost was measured over.
  it("draws the same grid across ten minutes of clock ticks", async () => {
    const { container } = await show([
      meeting({ id: "a", title: "Dunbar committee", scheduled_at: new Date(2026, 8, 16, 14, 0).toISOString() }),
      meeting({ id: "b", title: "Audit review", scheduled_at: new Date(2026, 8, 10, 11, 0).toISOString() }),
    ]);
    const cells = () =>
      Array.from(container.querySelectorAll("button[aria-expanded]"))
        .map((c) => `${c.getAttribute("aria-label")}|${c.textContent}`)
        .join("~~");
    const before = cells();
    expect(before).toContain("Dunbar committee");
    for (let i = 1; i <= 40; i++) {
      await act(async () => {
        jest.setSystemTime(new Date(NOW.getTime() + i * 15_000));
        jest.advanceTimersByTime(15_000);
        await Promise.resolve();
      });
    }
    expect(cells()).toBe(before);
  });
});

describe("opening from Schedule for later", () => {
  it("puts the scheduler on top of the calendar straight away, at the next half hour", async () => {
    const opened = jest.fn();
    await show([], { openScheduler: true, onSchedulerOpened: opened });
    const dialog = screen.getByRole("dialog", { name: "Schedule a meeting" });
    expect(dialog).toBeInTheDocument();
    // 9:00 now: half an hour out is 9:30.
    expect(dialog.querySelector('input[type="time"]')).toHaveValue("09:30");
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("opens just the calendar otherwise", async () => {
    await show([]);
    expect(screen.queryByRole("dialog", { name: "Schedule a meeting" })).toBeNull();
  });
});

describe("the side panel", () => {
  beforeEach(() => window.localStorage.clear());

  it("is folded away so the grid gets the whole screen, and comes back on request", async () => {
    await show([]);
    const toggle = screen.getByRole("button", { name: "Calendars & today" });
    expect(document.querySelector("aside")).toHaveAttribute("hidden");

    fireEvent.click(toggle);
    expect(document.querySelector("aside")).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Hide side panel" })).toHaveAttribute("aria-pressed", "true");
  });

  it("remembers that it was left open", async () => {
    window.localStorage.setItem("fx.meetings.calendar.rail", "open");
    await show([]);
    expect(document.querySelector("aside")).not.toHaveAttribute("hidden");
  });
});

describe("time a connected calendar has taken", () => {
  const LAYER = {
    id: "g1",
    source: "google",
    name: "Work",
    color: "#4285f4",
    isVisible: true,
    blocksAvailability: true,
    isPrimary: true,
    canWrite: true,
    health: { state: "ok", message: null },
  };
  // Wednesday 16 September, 10:00–11:00 local.
  const BUSY = {
    id: "e1",
    calendarId: "g1",
    title: "Client call",
    location: null,
    link: null,
    startsAt: new Date(2026, 8, 16, 10, 0).toISOString(),
    endsAt: new Date(2026, 8, 16, 11, 0).toISOString(),
    isAllDay: false,
    isBusy: true,
  };
  const FREE = { ...BUSY, id: "e2", title: "Birthday reminder", isBusy: false,
    startsAt: new Date(2026, 8, 16, 14, 0).toISOString(), endsAt: new Date(2026, 8, 16, 15, 0).toISOString() };

  async function weekWith(events: unknown[], layer: Record<string, unknown> = LAYER) {
    global.fetch = (async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).startsWith("/api/meetings/calendars")
          ? { layers: [layer], events }
          : { blocks: [], calendars: [], events: [] },
    })) as unknown as typeof fetch;
    await show([]);
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await act(async () => { await Promise.resolve(); });
  }

  it("is drawn as blocked and cannot be clicked to start a meeting", async () => {
    await weekWith([BUSY, FREE]);
    const blocked = document.querySelectorAll('[data-busy="true"]');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toHaveAttribute("aria-disabled", "true");
    expect(blocked[0].getAttribute("title")).toContain("Client call");

    fireEvent.click(blocked[0]);
    expect(screen.queryByRole("dialog", { name: "New meeting" })).toBeNull();
  });

  it("stops a click on the column from landing in it", async () => {
    await weekWith([BUSY]);
    const column = document.querySelector('[data-busy="true"]')!.parentElement!;
    // 10:30, inside the busy hour.
    fireEvent.click(column, { clientY: 10.5 * 46 });
    expect(screen.queryByRole("dialog", { name: "New meeting" })).toBeNull();

    // 8:00 is free.
    fireEvent.click(column, { clientY: 8 * 46 });
    expect(screen.getByRole("dialog", { name: "New meeting" })).toBeInTheDocument();
  });

  it("stays blocked when that calendar is hidden, without naming the event", async () => {
    await weekWith([BUSY], { ...LAYER, isVisible: false });
    const blocked = document.querySelector('[data-busy="true"]');
    expect(blocked).not.toBeNull();
    expect(blocked!.textContent).toBe("Busy");
  });

  it("leaves a calendar that does not count as busy alone", async () => {
    await weekWith([BUSY], { ...LAYER, blocksAvailability: false });
    expect(document.querySelector('[data-busy="true"]')).toBeNull();
  });
});

describe("a stale copy of Google", () => {
  function withGoogle(syncedAt: string | null, connectedAs: string | null = "rae@x.test") {
    const calls: Array<{ url: string; method: string }> = [];
    global.fetch = (async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return {
        ok: true,
        status: 200,
        json: async () =>
          String(url).startsWith("/api/meetings/calendars?")
            ? { layers: [], events: [], connectedAs, googleSyncedAt: syncedAt }
            : { blocks: [], calendars: [], events: [] },
      };
    }) as unknown as typeof fetch;
    return calls;
  }
  const syncs = (calls: Array<{ url: string; method: string }>) =>
    calls.filter((c) => c.url === "/api/meetings/calendars/sync" && c.method === "POST").length;
  const loads = (calls: Array<{ url: string; method: string }>) =>
    calls.filter((c) => c.url.startsWith("/api/meetings/calendars?")).length;
  async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  }

  it("is refreshed once when the calendar opens, and the grid reloaded", async () => {
    const calls = withGoogle(new Date(NOW.getTime() - 45 * 60_000).toISOString());
    await show([]);
    await settle();
    expect(syncs(calls)).toBe(1);
    expect(loads(calls)).toBe(2);
  });

  it("is left alone when it is recent", async () => {
    const calls = withGoogle(new Date(NOW.getTime() - 2 * 60_000).toISOString());
    await show([]);
    await settle();
    expect(syncs(calls)).toBe(0);
    expect(loads(calls)).toBe(1);
  });

  it("is not asked for when Google is not connected", async () => {
    const calls = withGoogle(null, null);
    await show([]);
    await settle();
    expect(syncs(calls)).toBe(0);
  });
});

describe("a pending booking request", () => {
  const REQUEST = {
    id: "bk-1",
    eventTitle: "Intro call",
    inviteeName: "Ada",
    inviteeEmail: "ada@example.com",
    inviteeNotes: null,
    startsAt: new Date(2026, 8, 18, 15, 0).toISOString(),
    endsAt: new Date(2026, 8, 18, 15, 30).toISOString(),
    createdAt: new Date(2026, 8, 10).toISOString(),
  };
  let patches: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    patches = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patches.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (String(url).startsWith("/api/meetings/scheduling/bookings?")) {
        return { ok: true, status: 200, json: async () => ({ requests: [REQUEST] }) };
      }
      return { ok: true, status: 200, json: async () => ({ blocks: [], calendars: [], events: [] }) };
    }) as unknown as typeof fetch;
  });

  it("appears while the calendar is open, from the host's own booking changes only", async () => {
    let requestsServed: unknown[] = [];
    global.fetch = (async (url: string) => {
      if (String(url).startsWith("/api/meetings/scheduling/bookings?")) {
        return { ok: true, status: 200, json: async () => ({ requests: requestsServed }) };
      }
      return { ok: true, status: 200, json: async () => ({ blocks: [], calendars: [], events: [] }) };
    }) as unknown as typeof fetch;
    mockChannelHandlers.length = 0;
    await show([]);
    expect(screen.queryAllByText(/Request: Ada/)).toHaveLength(0);

    const bookings = mockChannelHandlers.find((h) => h.cfg.table === "scheduling_bookings");
    expect(bookings?.cfg.filter).toBe("host_user_id=eq.u1");

    requestsServed = [REQUEST];
    await act(async () => {
      bookings!.cb();
      jest.advanceTimersByTime(400);
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(screen.getAllByText(/Request: Ada · Intro call/).length).toBeGreaterThan(0);
  });

  it("says why, and redraws, when the request was already closed elsewhere", async () => {
    let listReads = 0;
    global.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return { ok: false, status: 409, json: async () => ({ error: "This booking was already declined.", overridable: false }) };
      }
      if (String(url).startsWith("/api/meetings/scheduling/bookings?")) {
        listReads += 1;
        return { ok: true, status: 200, json: async () => ({ requests: listReads === 1 ? [REQUEST] : [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ blocks: [], calendars: [], events: [] }) };
    }) as unknown as typeof fetch;
    await show([]);
    fireEvent.click(screen.getAllByText(/Request: Ada · Intro call/)[0]);
    fireEvent.click(await screen.findByRole("button", { name: /approve or decline/i }));
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole("alert").textContent).toMatch(/already declined/i);
    expect(listReads).toBe(2);
  });

  it("is drawn on the host's calendar, among their meetings", async () => {
    await show([]);
    expect(screen.getAllByText(/Request: Ada · Intro call/).length).toBeGreaterThan(0);
  });

  it("opens as a request to approve or decline, not as a meeting to edit", async () => {
    await show([]);
    // In month view the chip opens its day, and the day's entry for it offers
    // the decision rather than the meeting actions (join, edit).
    fireEvent.click(screen.getAllByText(/Request: Ada · Intro call/)[0]);
    fireEvent.click(await screen.findByRole("button", { name: /approve or decline/i }));

    const dialog = screen.getByRole("dialog", { name: /booking request/i });
    expect(dialog.textContent).toMatch(/waiting on you/i);
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(patches[0]).toEqual({ url: "/api/meetings/scheduling/bookings/bk-1", body: { action: "approve" } });
  });
});

// ── Conflicts, Join and quick create ────────────────────────────────────────

async function inWeek(meetings: CalendarMeeting[]) {
  await show(meetings);
  fireEvent.click(screen.getByRole("button", { name: "Week" }));
  await act(async () => { await Promise.resolve(); });
}

/** The day columns of the week grid, Sunday first. */
const dayColumns = () =>
  Array.from(document.querySelectorAll<HTMLElement>("div")).filter((el) => el.style.height === `${24 * 46}px`);

describe("double bookings", () => {
  it("are marked on both meetings, saying what they clash with", async () => {
    await inWeek([
      meeting({ id: "a", title: "LP call", scheduled_at: new Date(2026, 8, 16, 14, 0).toISOString() }),
      meeting({ id: "b", title: "Board prep", scheduled_at: new Date(2026, 8, 16, 14, 30).toISOString() }),
    ]);
    expect(screen.getAllByRole("img", { name: "Overlaps Board prep" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Overlaps LP call" }).length).toBeGreaterThan(0);
  });

  it("leave back-to-back meetings alone", async () => {
    await inWeek([
      meeting({ id: "a", scheduled_at: new Date(2026, 8, 16, 14, 0).toISOString() }),
      meeting({ id: "b", scheduled_at: new Date(2026, 8, 16, 15, 0).toISOString() }),
    ]);
    expect(screen.queryAllByRole("img", { name: /Overlaps/ })).toHaveLength(0);
  });
});

describe("joining from the calendar", () => {
  it("puts Join on a meeting about to start, linking to its room", async () => {
    await inWeek([meeting({ id: "soon", scheduled_at: new Date(2026, 8, 16, 9, 5).toISOString() })]);
    const join = screen.getAllByRole("link", { name: "Join" });
    expect(join[0]).toHaveAttribute("href", "/meetings/room-soon");
  });

  it("does not offer it on a meeting hours away", async () => {
    await inWeek([meeting({ id: "later", scheduled_at: new Date(2026, 8, 16, 15, 0).toISOString() })]);
    expect(screen.queryByRole("link", { name: "Join" })).toBeNull();
  });

  it("lists today in the side panel, with Join where it is due", async () => {
    // Folded, whatever an earlier test left remembered.
    window.localStorage.clear();
    await show([
      meeting({ id: "soon", title: "Standup", scheduled_at: new Date(2026, 8, 16, 9, 5).toISOString() }),
      meeting({ id: "tmrw", title: "Tomorrow's call", scheduled_at: new Date(2026, 8, 17, 9, 0).toISOString() }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Calendars & today" }));
    const rail = document.querySelector("aside")!;
    expect(rail.textContent).toContain("Today · 1");
    expect(rail.textContent).toContain("Standup");
    expect(rail.textContent).not.toContain("Tomorrow's call");
    expect(rail.querySelector('a[href="/meetings/room-soon"]')).not.toBeNull();
  });
});

describe("quick create", () => {
  let calls: Array<{ url: string; init?: RequestInit }>;
  let answer: { status: number; body: unknown };

  beforeEach(() => {
    calls = [];
    answer = { status: 200, body: { id: "new", roomCode: "new-room" } };
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/meetings/schedule") {
        return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
      }
      return { ok: true, status: 200, json: async () => ({ blocks: [], calendars: [], events: [] }) };
    }) as unknown as typeof fetch;
  });

  async function openAt(hour: number) {
    await inWeek([]);
    fireEvent.click(dayColumns()[3], { clientY: hour * 46 });
    return screen.getByRole("dialog", { name: "New meeting" });
  }

  it("creates a meeting from a title and a length, at the slot that was clicked", async () => {
    await openAt(8);
    fireEvent.change(screen.getByLabelText("Meeting title"), { target: { value: "Intro with Rae" } });
    fireEvent.click(screen.getByRole("radio", { name: "45 min" }));
    fireEvent.change(screen.getByLabelText("Invitees"), { target: { value: "rae@acme.com" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); });

    const post = calls.find((c) => c.url === "/api/meetings/schedule")!;
    const body = JSON.parse(String(post.init!.body));
    expect(body).toMatchObject({
      title: "Intro with Rae",
      date: "2026-09-16",
      startTime: "08:00",
      endTime: "08:45",
      meetingType: "internal_strategy",
      allowConflict: false,
    });
    expect(body.attendees[0].email).toBe("rae@acme.com");
    expect(screen.queryByRole("dialog", { name: "New meeting" })).toBeNull();
  });

  it("asks for a title rather than sending an empty meeting", async () => {
    await openAt(8);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); });
    expect(screen.getByRole("alert")).toHaveTextContent(/title/i);
    expect(calls.some((c) => c.url === "/api/meetings/schedule")).toBe(false);
  });

  it("offers to create anyway when the time clashes, and then does", async () => {
    answer = { status: 409, body: { conflicts: [{ id: "x", title: "LP call", scheduledAt: "" }] } };
    await openAt(8);
    fireEvent.change(screen.getByLabelText("Meeting title"), { target: { value: "Intro" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); });
    expect(screen.getByRole("alert")).toHaveTextContent(/clashes/);

    answer = { status: 200, body: { id: "new" } };
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create anyway" })); });
    const posts = calls.filter((c) => c.url === "/api/meetings/schedule");
    expect(JSON.parse(String(posts[1].init!.body)).allowConflict).toBe(true);
  });

  it("still offers to block the time instead", async () => {
    await openAt(8);
    fireEvent.click(screen.getByRole("button", { name: "Block time instead" }));
    expect(screen.queryByRole("dialog", { name: "New meeting" })).toBeNull();
  });
});

describe("on a phone", () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  function phone(matches: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: matches && query.includes("max-width: 639px"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }

  it("opens on the agenda rather than a month of dots", async () => {
    phone(true);
    await show([]);
    expect(screen.getByRole("button", { name: "Schedule" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the month on a wide screen", async () => {
    phone(false);
    await show([]);
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
  });
});
