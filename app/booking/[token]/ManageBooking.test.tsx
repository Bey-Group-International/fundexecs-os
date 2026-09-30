/**
 * The page a stranger reaches from the one email they have about their meeting.
 *
 * It had no test at all, and it has just changed shape: the server reads the
 * booking now and hands it over, so the page must paint from that without asking
 * again — and must still recover when the server could not read it. Those are the
 * two paths that matter, and both are exact: either a fetch happened or it did
 * not.
 *
 * What is NOT here: the wall-clock saving. That is one database round trip —
 * seven reads at a serial depth of four — and no assertion in jsdom can see it.
 * The numbers are in the pull request.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ManageBooking } from "./ManageBooking";
import type { ManageBookingView } from "@/lib/meetings/booking-manage";

// Far enough ahead that the real clock never makes these meetings past.
const STARTS = "2099-10-05T14:00:00.000Z";
const ENDS = "2099-10-05T14:30:00.000Z";

function view(over: Partial<ManageBookingView["booking"]> = {}): ManageBookingView {
  return {
    booking: {
      id: "b1",
      eventTitle: "Intro call",
      inviteeName: "Ada Lovelace",
      startsAt: STARTS,
      endsAt: ENDS,
      status: "confirmed",
      cancelledBy: null,
      cancellationReason: null,
      inviteeTimezone: "America/New_York",
      ...over,
    },
    page: { slug: "ana", displayName: "Ana" },
    eventType: { title: "Intro call", durationMinutes: 30 },
    joinUrl: "https://app.test/j/ABC123",
    bookingPageUrl: "https://app.test/book/ana",
    hostTimezone: "America/New_York",
    slots: [{ start: "2099-10-07T14:00:00.000Z", end: "2099-10-07T14:30:00.000Z" }],
  };
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => view() });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe("what the server already read", () => {
  it("paints the booking the server sent, without asking for it again", async () => {
    render(<ManageBooking token="tok" initialView={view()} />);

    // No spinner, and everything on screen in the first render.
    expect(screen.queryByText(/loading your booking/i)).toBeNull();
    expect(screen.getByRole("heading", { name: "Intro call" })).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByRole("link", { name: /join meeting/i }).getAttribute("href")).toBe(
      "https://app.test/j/ABC123",
    );

    // Give any mount effect the chance to fire a request.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to fetching when the server could not read it", async () => {
    render(<ManageBooking token="tok" />);
    expect(screen.getByText(/loading your booking/i)).toBeTruthy();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/scheduling/booking/tok", { cache: "no-store" }),
    );
    expect(await screen.findByRole("heading", { name: "Intro call" })).toBeTruthy();
  });

  /**
   * An expired or mistyped link is an answer, not a failure — so the page says so
   * and does not ask a second time. Telling the two apart is the whole reason the
   * prop has three states rather than two: a deployment missing its keys must not
   * tell somebody holding a perfectly good link that it is invalid.
   */
  it("says the link is invalid without asking again when the server found nothing", async () => {
    render(<ManageBooking token="tok" initialView={null} />);
    expect(screen.getByText(/invalid or has expired/i)).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the zone times are shown in", () => {
  it("moves off UTC to the viewer's own zone after mount", async () => {
    render(<ManageBooking token="tok" initialView={view()} />);
    // jsdom runs at UTC unless TZ says otherwise, so the assertion that holds
    // everywhere is that a zone was resolved and the time is the right instant.
    await waitFor(() => expect(screen.getByText(/2099/)).toBeTruthy());
    expect(screen.getByText(/October 5, 2099/)).toBeTruthy();
  });

  /**
   * The bug this replaced: the zone was re-resolved on every load, so cancelling
   * — which reloads the booking — threw away the zone the invitee had just picked
   * from the dropdown. It is resolved once now, on the first view to arrive.
   */
  it("keeps the zone the invitee picked when the booking reloads", async () => {
    render(<ManageBooking token="tok" initialView={view()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Asia/Tokyo" } });
    expect(select.value).toBe("Asia/Tokyo");
    // 14:00Z reads as 11:00 PM in Tokyo — proof the whole page re-read the zone,
    // not just the dropdown.
    expect(screen.getByText(/11:00 PM GMT\+9/)).toBeTruthy();

    // Cancel, which posts and then reloads the booking.
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: true, status: 200, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => view({ status: "cancelled", cancelledBy: "invitee" }) },
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel booking/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /cancel this booking/i }));
    });

    await screen.findByText("Cancelled");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("Asia/Tokyo");
    expect(screen.getByText(/11:00 PM GMT\+9/)).toBeTruthy();
  });
});

describe("a meeting that has already happened", () => {
  const PAST = { startsAt: "2020-01-01T10:00:00.000Z", endsAt: "2020-01-01T10:30:00.000Z" };

  /**
   * Whether the meeting has passed decides which controls exist, so it is taken
   * from the instant the server rendered at rather than from the browser's clock:
   * otherwise the client's first render could disagree with the server's HTML for
   * any meeting that ended between the two, which is a hydration mismatch.
   *
   * Asserted against the markup the server actually produces, because that is
   * where the property lives — `render` from testing-library flushes the mount
   * effect before it returns, so the clock has already moved on by the time
   * anything can be queried.
   */
  it("decides the server's markup by the server's own instant", () => {
    const before = renderToString(
      <ManageBooking token="tok" initialView={view(PAST)} serverNowIso="2020-01-01T09:00:00.000Z" />,
    );
    expect(before).toContain("Reschedule");
    expect(before).toContain("Join meeting");

    const after = renderToString(
      <ManageBooking token="tok" initialView={view(PAST)} serverNowIso="2020-06-01T09:00:00.000Z" />,
    );
    expect(after).not.toContain("Reschedule");
    expect(after).not.toContain("Join meeting");
    expect(after).toContain("Book another time");
  });

  // And on the client the real clock takes over on mount, so HTML rendered with a
  // stale instant does not leave a finished meeting looking joinable.
  it("drops the controls once the real clock replaces the server's instant", async () => {
    render(<ManageBooking token="tok" initialView={view(PAST)} serverNowIso="2020-01-01T09:00:00.000Z" />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^reschedule$/i })).toBeNull());
    expect(screen.getByRole("link", { name: /book another time/i })).toBeTruthy();
  });

  it("offers no controls at all when the server already knew it had passed", async () => {
    render(<ManageBooking token="tok" initialView={view(PAST)} serverNowIso="2020-06-01T09:00:00.000Z" />);
    expect(screen.queryByRole("button", { name: /^reschedule$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /join meeting/i })).toBeNull();
  });
});

describe("moving the meeting", () => {
  it("offers the times the server sent and posts the one picked", async () => {
    render(<ManageBooking token="tok" initialView={view()} />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /^reschedule$/i }));
    const slot = screen.getByRole("button", { name: /^\d{1,2}:\d{2}\s?(AM|PM)$/ });
    fireEvent.click(slot);

    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: true, status: 200, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => view() },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm new time/i }));
    });

    const posted = fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === "POST");
    expect(posted).toBeTruthy();
    expect(JSON.parse((posted![1] as { body: string }).body)).toEqual({
      action: "reschedule",
      startIso: "2099-10-07T14:00:00.000Z",
      reason: undefined,
    });
  });

  it("keeps the invitee on the page and says why when the time has gone", async () => {
    render(<ManageBooking token="tok" initialView={view()} />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /^reschedule$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^\d{1,2}:\d{2}\s?(AM|PM)$/ }));

    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: false, status: 409, json: async () => ({ error: "That time was just taken." }) }
        : { ok: true, status: 200, json: async () => view() },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm new time/i }));
    });

    expect(await screen.findByText(/that time was just taken/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /confirm new time/i })).toBeTruthy();
  });
});
