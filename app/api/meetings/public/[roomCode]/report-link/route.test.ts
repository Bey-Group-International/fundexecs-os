/**
 * A guest's report link: minted only for a key the host admitted to this
 * room, carrying a digest of that key, and honest about whether there is a
 * report to open yet.
 */
const from = jest.fn();
let serviceEnv = true;

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => serviceEnv,
  createServiceClient: () => ({ from: (t: string) => from(t) }),
  createServerClient: async () => ({ from: (t: string) => from(t) }),
}));

const ENV = process.env.SUPABASE_SERVICE_ROLE_KEY;
beforeAll(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key"; });
afterAll(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = ENV; });

import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";
import { guestSubject, verifyReportShare } from "@/lib/meetings/report-share.server";
import { POST } from "./route";

const params = { params: Promise.resolve({ roomCode: "abc-defg-hi" }) };

function req(body: unknown, ip = "198.51.100.7"): NextRequest {
  return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi/report-link", {
    method: "POST",
    headers: { "x-vercel-forwarded-for": ip, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** What each table answers. */
const db: { meeting: unknown; admission: unknown; reports: unknown[] } = {
  meeting: { id: "m1", room_code: "abc-defg-hi" },
  admission: { id: "adm-1" },
  reports: [{ id: "r1" }],
};
/** The (column, value) filters the admission read was made with. */
let admissionFilters: Array<[string, unknown]> = [];

beforeEach(() => {
  jest.clearAllMocks();
  clearRateLimitBucketsForTests();
  serviceEnv = true;
  db.meeting = { id: "m1", room_code: "abc-defg-hi" };
  db.admission = { id: "adm-1" };
  db.reports = [{ id: "r1" }];
  admissionFilters = [];
  from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      is: () => b,
      eq: (col: string, v: unknown) => { if (table === "live_meeting_admissions") admissionFilters.push([col, v]); return b; },
      maybeSingle: async () => ({ data: table === "live_meetings" ? db.meeting : db.admission }),
      limit: async () => ({ data: db.reports }),
    };
    return b;
  });
});

it("mints a link naming the meeting and a digest of the admitted key", async () => {
  const res = await POST(req({ guestKey: "guest-key-77" }), params);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url: string; ready: boolean };
  expect(body.ready).toBe(true);
  const token = body.url.slice(body.url.lastIndexOf("/r/report/") + "/r/report/".length);
  expect(verifyReportShare(token)).toMatchObject({ r: "abc-defg-hi", g: guestSubject("guest-key-77") });
  expect(body.url).not.toContain("guest-key-77");
  expect(res.headers.get("cache-control")).toContain("no-store");
});

it("checks the key against THIS meeting's admitted rows", async () => {
  await POST(req({ guestKey: "guest-key-77" }), params);
  expect(admissionFilters).toEqual(expect.arrayContaining([
    ["meeting_id", "m1"], ["guest_key", "guest-key-77"], ["status", "admitted"],
  ]));
});

it("says the link is not ready when there is no report row yet", async () => {
  db.reports = [];
  const body = await (await POST(req({ guestKey: "guest-key-77" }), params)).json();
  expect(body).toMatchObject({ ready: false });
  expect(typeof body.url).toBe("string");
});

it("refuses a key the host never admitted, and an unknown room, identically", async () => {
  db.admission = null;
  expect((await POST(req({ guestKey: "stranger" }), params)).status).toBe(401);
  db.admission = { id: "adm-1" };
  db.meeting = null;
  expect((await POST(req({ guestKey: "guest-key-77" }), params)).status).toBe(401);
});

it("refuses a request with no key before touching the database", async () => {
  expect((await POST(req({}), params)).status).toBe(400);
  expect(from).not.toHaveBeenCalled();
});

it("cannot mint anything without the service key", async () => {
  serviceEnv = false;
  expect((await POST(req({ guestKey: "guest-key-77" }), params)).status).toBe(503);
  expect(from).not.toHaveBeenCalled();
});

it("is rate limited per address", async () => {
  let last = 200;
  for (let i = 0; i < 40 && last !== 429; i++) {
    last = (await POST(req({ guestKey: "guest-key-77" }, "203.0.113.9"), params)).status;
  }
  expect(last).toBe(429);
});
