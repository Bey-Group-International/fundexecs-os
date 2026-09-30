/**
 * The first screen of a public booking link.
 *
 * The page now sends the open times with the HTML, so the picker must paint
 * from them without a spinner and without asking /slots for what it already
 * has — and must still fetch when the server could not supply them.
 *
 * It also holds the one exact guard on the page's cost: typing in the form must
 * not rebuild the date formatters behind the grid above it. See the bottom.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookingFlow } from "./BookingFlow";

const EVENT = {
  id: "t1",
  slug: "intro",
  title: "Intro call",
  description: null,
  durationMinutes: 30,
  requiresApproval: false,
};

const SLOT = { start: "2026-10-05T14:00:00.000Z", end: "2026-10-05T14:30:00.000Z" };

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slots: [SLOT] }) });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

it("uses the slots the server sent and does not fetch them again", async () => {
  render(<BookingFlow slug="ana" hostName="Ana" eventType={EVENT} initialSlots={[SLOT]} />);
  // Give any mount effect the chance to fire a request.
  await new Promise((r) => setTimeout(r, 0));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByText(/finding open times/i)).toBeNull();
});

it("falls back to fetching when the server sent none", async () => {
  render(<BookingFlow slug="ana" hostName="Ana" eventType={EVENT} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/scheduling/ana/intro/slots", { cache: "no-store" }));
});

describe("after booking", () => {
  async function book(response: Record<string, unknown>) {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/book")
        ? { ok: true, json: async () => response }
        : { ok: true, json: async () => ({ slots: [SLOT] }) },
    );
    render(<BookingFlow slug="ana" hostName="Ana" eventType={EVENT} initialSlots={[SLOT]} />);
    fireEvent.click(await screen.findByRole("button", { name: /\d{1,2}:\d{2}/ }));
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/your email/i), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm booking/i }));
    await screen.findByText(/you're booked/i);
  }

  it("doesn't claim an email went out when it didn't, and offers the calendar file instead", async () => {
    await book({
      status: "confirmed",
      joinUrl: "https://app.test/j",
      manageUrl: "https://app.test/b/tok",
      calendarUrl: "https://app.test/api/scheduling/booking/tok/calendar.ics",
      emailed: false,
    });
    expect(screen.queryByText(/we've emailed you/i)).toBeNull();
    expect(screen.getByText(/couldn't email/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /add to calendar/i }).getAttribute("href")).toBe(
      "https://app.test/api/scheduling/booking/tok/calendar.ics",
    );
  });

  it("says it emailed you when it did", async () => {
    await book({ status: "confirmed", joinUrl: null, manageUrl: "https://app.test/b/tok", calendarUrl: null, emailed: true });
    expect(screen.getByText(/we've emailed you/i)).toBeTruthy();
  });
});

/**
 * What typing costs.
 *
 * The form fields live in this component, so every character re-rendered the
 * picker sitting above them — a fortnight of days in the rail and every open
 * time in the day on screen. Each of those labels built its own
 * Intl.DateTimeFormat, so one keystroke constructed sixty formatters, measured
 * at 15–22ms apiece on a 336-slot window; a twelve-character name cost about a
 * third of a second of nothing but formatter construction.
 *
 * Two changes fixed it: the formatters are cached per zone in
 * lib/meetings/scheduling.ts, and the picker is memoised so it is not re-rendered
 * at all. The memo cannot be asserted from here — a component that skips a
 * render writes nothing to the DOM either way, and the render counts are in the
 * pull request with a Profiler. The formatter count can be, exactly, and it is
 * the cost that was actually being paid.
 */
describe("what typing costs", () => {
  function manySlots(days: number, perDay: number) {
    const out: Array<{ start: string; end: string }> = [];
    const base = Date.UTC(2026, 9, 5, 13, 0);
    for (let d = 0; d < days; d++) {
      for (let i = 0; i < perDay; i++) {
        const start = base + d * 86_400_000 + i * 30 * 60_000;
        out.push({ start: new Date(start).toISOString(), end: new Date(start + 1_800_000).toISOString() });
      }
    }
    return out;
  }

  it("does not rebuild a single date formatter while somebody types their name", async () => {
    const slots = manySlots(21, 16);
    render(<BookingFlow slug="ana" hostName="Ana" eventType={EVENT} initialSlots={slots} />);

    // Pick a time so the name field exists. Everything up to here may build
    // formatters; the page has painted and this is where an invitee starts typing.
    fireEvent.click(screen.getAllByRole("button", { name: /^\d{1,2}:\d{2}\s?(AM|PM)$/ })[0]);
    const name = screen.getByLabelText(/your name/i) as HTMLInputElement;

    const Real = Intl.DateTimeFormat;
    let built = 0;
    const Counting = function (...args: unknown[]) {
      built++;
      return new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Counting.supportedLocalesOf = Real.supportedLocalesOf;
    Intl.DateTimeFormat = Counting;
    try {
      for (const ch of "Ada Lovelace") {
        await act(async () => {
          fireEvent.change(name, { target: { value: name.value + ch } });
        });
      }
    } finally {
      Intl.DateTimeFormat = Real;
    }

    expect(name.value).toBe("Ada Lovelace");
    // Sixty per keystroke before: forty-two for the day rail, sixteen for the
    // times, one for the day heading, one for the chosen slot's stamp.
    expect(built).toBe(0);
  });
});

describe("coming back to a stale tab", () => {
  const LATER = { start: "2026-10-05T15:00:00.000Z", end: "2026-10-05T15:30:00.000Z" };
  let now = 1_000_000;
  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  function returnToTab() {
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("quietly reloads the open times", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slots: [SLOT, LATER] }) });
    render(<BookingFlow slug="ana" hostName="Ana" eventType={EVENT} initialSlots={[SLOT]} />);
    now += 6 * 60_000;
    returnToTab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/scheduling/ana/intro/slots", { cache: "no-store" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /\d{1,2}:\d{2}/ })).toHaveLength(2));
    // Quiet: the grid never gave way to a spinner.
    expect(screen.queryByText(/finding open times/i)).toBeNull();
  });

  it("drops a picked time that has gone, and says so", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ slots: [LATER] }) });
    render(<BookingFlow slug="ana" hostName="Ana" eventType={EVENT} initialSlots={[SLOT]} />);
    fireEvent.click(await screen.findByRole("button", { name: /\d{1,2}:\d{2}/ }));
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();

    now += 6 * 60_000;
    returnToTab();

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
  });

  it("does not reload a page that was just loaded", async () => {
    render(<BookingFlow slug="ana" hostName="Ana" eventType={EVENT} initialSlots={[SLOT]} />);
    now += 60_000;
    returnToTab();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BookingFlow prefill", () => {
  it("starts the form with the name and email the link carried", async () => {
    render(
      <BookingFlow
        slug="ana"
        hostName="Ana"
        eventType={EVENT}
        initialSlots={[SLOT]}
        prefill={{ name: "Ada Lovelace", email: "ada@example.com" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /\d{1,2}:\d{2}/ }));
    expect(screen.getByLabelText(/your name/i)).toHaveValue("Ada Lovelace");
    expect(screen.getByLabelText(/email/i)).toHaveValue("ada@example.com");
  });
});
