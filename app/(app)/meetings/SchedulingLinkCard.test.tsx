/**
 * The host's booking list on the Meetings landing. Declining a request and
 * cancelling a booking both email a stranger and cannot be undone, so neither
 * may happen on one click, and the host gets to say why.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SchedulingLinkCard } from "./SchedulingLinkCard";

jest.mock("next/dynamic", () => () => () => null);

function booking(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    eventTypeId: "t1",
    eventTitle: "Intro call",
    inviteeName: "Ada",
    inviteeEmail: "ada@example.com",
    inviteeNotes: null,
    inviteeGuests: [],
    inviteeTimezone: "UTC",
    startsAt: "2099-10-05T14:00:00.000Z",
    endsAt: "2099-10-05T14:30:00.000Z",
    status: "confirmed",
    cancelledBy: null,
    cancellationReason: null,
    meetingId: "m1",
    createdAt: "2099-10-01T00:00:00.000Z",
    ...over,
  };
}

function snapshot(bookings: unknown[]) {
  return {
    page: { id: "p1", slug: "ana", displayName: "Ana", headline: null, bio: null, timezone: "UTC", availability: [], bufferMinutes: 0, minNoticeMinutes: 0, bookingWindowDays: 30, maxBookingsPerDay: null, isActive: true },
    eventTypes: [],
    bookings,
    bookingUrl: "https://app.test/book/ana",
  };
}

const fetchMock = jest.fn();

function serve(bookings: unknown[]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return { ok: true, json: async () => ({ booking: {} }) };
    return { ok: true, json: async () => snapshot(bookings) };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

function patches() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
}

it("does not cancel a booking on the first click, and sends the reason on the second", async () => {
  serve([booking()]);
  render(<SchedulingLinkCard />);
  fireEvent.click(await screen.findByRole("button", { name: /1 booked through your link/i }));

  fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
  expect(patches()).toHaveLength(0);
  expect(screen.getByText(/cancel the meeting with ada\?/i)).toBeTruthy();

  fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "  Travel conflict  " } });
  fireEvent.click(screen.getByRole("button", { name: /cancel meeting/i }));

  await waitFor(() => expect(patches()).toHaveLength(1));
  const [url, init] = patches()[0];
  expect(url).toBe("/api/meetings/scheduling/bookings/b1");
  expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "cancel", reason: "Travel conflict" });
});

it("lets the host back out", async () => {
  serve([booking()]);
  render(<SchedulingLinkCard />);
  fireEvent.click(await screen.findByRole("button", { name: /1 booked through your link/i }));
  fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
  fireEvent.click(screen.getByRole("button", { name: /keep it/i }));
  expect(screen.getByRole("button", { name: /^cancel$/i })).toBeTruthy();
  expect(patches()).toHaveLength(0);
});

it("confirms a decline too, but approves in one click", async () => {
  serve([booking({ id: "b2", status: "pending" })]);
  render(<SchedulingLinkCard />);
  fireEvent.click(await screen.findByRole("button", { name: /1 waiting on you/i }));

  fireEvent.click(screen.getByRole("button", { name: /^decline$/i }));
  expect(patches()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /decline request/i }));
  await waitFor(() => expect(patches()).toHaveLength(1));
  expect(JSON.parse((patches()[0][1] as RequestInit).body as string)).toEqual({ action: "decline" });
});

it("shows who else is coming", async () => {
  serve([booking({ inviteeGuests: ["grace@example.com", "alan@example.com"] })]);
  render(<SchedulingLinkCard />);
  fireEvent.click(await screen.findByRole("button", { name: /1 booked through your link/i }));
  expect(screen.getByText(/2 guests: grace@example.com, alan@example.com/)).toBeTruthy();
});

it("says there are more than five upcoming bookings, and can show them", async () => {
  serve(Array.from({ length: 7 }, (_, i) => booking({ id: `b${i}`, inviteeName: `Person ${i}` })));
  render(<SchedulingLinkCard />);
  fireEvent.click(await screen.findByRole("button", { name: /7 booked through your link/i }));
  expect(screen.queryByText(/Person 6/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /show all 7/i }));
  expect(screen.getByText(/Person 6/)).toBeTruthy();
});

it("asks before approving over the host's own calendar, then approves anyway", async () => {
  let calls = 0;
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      calls += 1;
      return calls === 1
        ? { ok: false, status: 409, json: async () => ({ error: "That time now overlaps something on your calendar.", overridable: true }) }
        : { ok: true, status: 200, json: async () => ({ booking: {} }) };
    }
    return { ok: true, json: async () => snapshot([booking({ status: "pending", meetingId: null })]) };
  });
  render(<SchedulingLinkCard />);
  fireEvent.click(await screen.findByRole("button", { name: /1 waiting on you/i }));
  fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

  fireEvent.click(await screen.findByRole("button", { name: /approve anyway/i }));
  await waitFor(() => expect(patches()).toHaveLength(2));
  expect(JSON.parse((patches()[1][1] as RequestInit).body as string)).toEqual({ action: "approve", allowConflict: true });
});

it("moves a booking to any time the host picks", async () => {
  serve([booking()]);
  render(<SchedulingLinkCard />);
  fireEvent.click(await screen.findByRole("button", { name: /1 booked through your link/i }));
  fireEvent.click(screen.getByRole("button", { name: /reschedule/i }));

  fireEvent.change(screen.getByLabelText(/new time for ada/i), { target: { value: "2099-10-06T06:15" } });
  fireEvent.click(screen.getByRole("button", { name: /move booking/i }));

  await waitFor(() => expect(patches()).toHaveLength(1));
  expect(JSON.parse((patches()[0][1] as RequestInit).body as string)).toEqual({
    action: "reschedule",
    startIso: new Date("2099-10-06T06:15").toISOString(),
  });
});

describe("in the lobby's toolbar", () => {
  it("is a copy button and Availability, with no link text and no card", async () => {
    serve([]);
    const { container } = render(<SchedulingLinkCard inline />);
    const copy = await screen.findByRole("button", { name: /copy booking link/i });
    expect(copy).toHaveAttribute("title", "https://app.test/book/ana");
    expect(screen.getByRole("button", { name: "Availability" })).toBeTruthy();
    expect(screen.queryByText("https://app.test/book/ana")).toBeNull();
    expect(container.querySelector("section")).toBeNull();
  });

  it("announces requests waiting on the host, and opens them below", async () => {
    serve([booking({ status: "pending" })]);
    render(<SchedulingLinkCard inline />);
    fireEvent.click(await screen.findByRole("button", { name: /1 booking request/i }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("stays out of the toolbar when the link could not be loaded", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: "nope" }) }));
    const { container } = render(<SchedulingLinkCard inline />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
