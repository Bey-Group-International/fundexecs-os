const loadBookingByTokenMock = jest.fn();
const hasServiceEnvMock = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({}),
  hasSupabaseServiceEnv: () => hasServiceEnvMock(),
}));

jest.mock("@/lib/meetings/scheduling-service", () => ({
  loadBookingByToken: (...args: unknown[]) => loadBookingByTokenMock(...args),
}));

jest.mock("@/lib/site", () => ({ SITE_URL: "https://app.test" }));

import { NextRequest } from "next/server";
import { GET } from "./route";

const params = (token: string) => ({ params: Promise.resolve({ token }) });
const req = () => new NextRequest("http://localhost/api/scheduling/booking/tok/calendar.ics");

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      id: "b1",
      status: "confirmed",
      starts_at: "2026-09-10T15:00:00.000Z",
      ends_at: "2026-09-10T15:30:00.000Z",
      calendar_sequence: 3,
      invitee_email: "ada@lp.test",
      invitee_name: "Ada",
      ...(overrides.booking as object ?? {}),
    },
    page: { display_name: "Nia", timezone: "UTC", slug: "nia" },
    eventType: { title: "Intro call", duration_minutes: 30 },
    roomCode: "abc-def",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  hasServiceEnvMock.mockReturnValue(true);
  loadBookingByTokenMock.mockResolvedValue(ctx());
});

describe("GET /api/scheduling/booking/[token]/calendar.ics", () => {
  it("serves a confirmed booking as a downloadable entry", async () => {
    const res = await GET(req(), params("tok"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    const body = await res.text();
    expect(body).toContain("SUMMARY:Intro call with Nia");
    expect(body).toContain("DTSTART:20260910T150000Z");
    expect(body).toContain("DTEND:20260910T153000Z");
    expect(body).toContain("SEQUENCE:3");
    expect(body).toContain("app.test/meeting-invite/abc-def");
  });

  it("reuses the booking UID, not the meeting's", async () => {
    // The confirmation's own .ics is booking-scoped. A meeting-scoped UID here
    // would put the same meeting in the invitee's calendar a second time.
    const body = await (await GET(req(), params("tok"))).text();
    expect(body).toContain("UID:booking-b1@app.test");
  });

  it("publishes rather than invites, and names nobody", async () => {
    const body = await (await GET(req(), params("tok"))).text();
    expect(body).toContain("METHOD:PUBLISH");
    expect(body).not.toContain("ORGANIZER");
    expect(body).not.toContain("ATTENDEE");
    expect(body).not.toContain("ada@lp.test");
  });

  it("refuses a booking that is not confirmed", async () => {
    // A pending request is a hold the host may still decline; putting it in
    // somebody's calendar is what the .ics policy already refuses to do.
    for (const status of ["pending", "cancelled", "declined"]) {
      loadBookingByTokenMock.mockResolvedValue(ctx({ booking: { status } }));
      expect((await GET(req(), params("tok"))).status).toBe(404);
    }
  });

  it("404s for an unknown token, a blank one, and an unconfigured deployment", async () => {
    loadBookingByTokenMock.mockResolvedValue(null);
    expect((await GET(req(), params("tok"))).status).toBe(404);

    expect((await GET(req(), params("  "))).status).toBe(404);

    hasServiceEnvMock.mockReturnValue(false);
    expect((await GET(req(), params("tok"))).status).toBe(404);
  });

  it("answers 404 on an internal failure rather than a 500", async () => {
    loadBookingByTokenMock.mockRejectedValue(new Error("db down"));
    expect((await GET(req(), params("tok"))).status).toBe(404);
  });

  it("is never cached or indexed", async () => {
    const res = await GET(req(), params("tok"));
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });
});
