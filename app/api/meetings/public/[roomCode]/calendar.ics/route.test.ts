const from = jest.fn();
const hasServiceEnvMock = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from }),
  createServiceClient: () => ({ from }),
  hasSupabaseServiceEnv: () => hasServiceEnvMock(),
}));

jest.mock("@/lib/site", () => ({ SITE_URL: "https://app.test" }));

import { NextRequest } from "next/server";
import { GET } from "./route";

const params = (roomCode: string) => ({ params: Promise.resolve({ roomCode }) });
const req = () => new NextRequest("http://localhost/api/meetings/public/abc-def/calendar.ics");

const ROW = {
  id: "m1",
  title: "Quarterly review",
  scheduled_at: "2026-09-10T15:00:00.000Z",
  duration_minutes: 30,
  location: null,
  meeting_url: null,
  room_code: "abc-def",
  is_draft: false,
  calendar_sequence: 2,
};

function builder(data: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    is: () => b,
    maybeSingle: async () => (data instanceof Error ? { error: data } : { data }),
  };
  return b;
}

beforeEach(() => {
  jest.clearAllMocks();
  hasServiceEnvMock.mockReturnValue(true);
  from.mockReturnValue(builder(ROW));
});

describe("GET /api/meetings/public/[roomCode]/calendar.ics", () => {
  it("serves the meeting as a downloadable calendar entry", async () => {
    const res = await GET(req(), params("abc-def"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    const body = await res.text();
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("SUMMARY:Quarterly review");
    expect(body).toContain("DTSTART:20260910T150000Z");
    expect(body).toContain("DTEND:20260910T153000Z");
    expect(body).toContain("SEQUENCE:2");
  });

  it("reuses the UID the emailed invitation carries", async () => {
    // Otherwise saving from the button gives the recipient the meeting twice:
    // once from the attachment their client accepted, once from this.
    const body = await (await GET(req(), params("abc-def"))).text();
    expect(body).toContain("UID:meeting-m1@app.test");
  });

  it("publishes rather than invites, and names nobody", async () => {
    // Anyone holding the link can fetch this. An iTIP REQUEST would have to
    // carry an ORGANIZER address and the attendee list, which the public
    // lookup deliberately withholds.
    const body = await (await GET(req(), params("abc-def"))).text();
    expect(body).toContain("METHOD:PUBLISH");
    expect(body).not.toContain("ORGANIZER");
    expect(body).not.toContain("ATTENDEE");
  });

  it("points at the meeting's own place when it has one", async () => {
    from.mockReturnValue(builder({ ...ROW, location: "Room 9" }));
    const body = await (await GET(req(), params("abc-def"))).text();
    expect(body).toContain("LOCATION:Room 9");
    // The room link is still reachable from the entry.
    expect(body).toContain("app.test/meeting-invite/abc-def");
  });

  it("falls back to the meeting room when there is no other place", async () => {
    const body = await (await GET(req(), params("abc-def"))).text();
    expect(body).toContain("LOCATION:https://app.test/meeting-invite/abc-def");
  });

  it("404s for a draft, an untimed meeting, and an unknown code", async () => {
    from.mockReturnValue(builder({ ...ROW, is_draft: true }));
    expect((await GET(req(), params("abc-def"))).status).toBe(404);

    from.mockReturnValue(builder({ ...ROW, scheduled_at: null }));
    expect((await GET(req(), params("abc-def"))).status).toBe(404);

    from.mockReturnValue(builder({ ...ROW, scheduled_at: "not a date" }));
    expect((await GET(req(), params("abc-def"))).status).toBe(404);

    from.mockReturnValue(builder(null));
    expect((await GET(req(), params("abc-def"))).status).toBe(404);

    expect((await GET(req(), params("  "))).status).toBe(404);
  });

  it("answers 404 on an internal failure rather than a 500", async () => {
    // A 500 would confirm to a guesser that some codes behave differently.
    from.mockImplementation(() => {
      throw new Error("db down");
    });
    expect((await GET(req(), params("abc-def"))).status).toBe(404);
  });

  it("is never cached or indexed", async () => {
    const res = await GET(req(), params("abc-def"));
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });
});
