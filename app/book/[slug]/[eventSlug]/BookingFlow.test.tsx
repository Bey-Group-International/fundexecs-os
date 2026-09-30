/**
 * The first screen of a public booking link.
 *
 * The page now sends the open times with the HTML, so the picker must paint
 * from them without a spinner and without asking /slots for what it already
 * has — and must still fetch when the server could not supply them.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
