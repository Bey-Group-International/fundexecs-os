// The host's pending requests, for their calendar: only theirs, only pending,
// and never a request whose time has already gone.
const authMock = jest.fn();
const listBookingsForHost = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
jest.mock("@/lib/meetings/scheduling-service", () => ({
  listBookingsForHost: (...a: unknown[]) => listBookingsForHost(...a),
  serializeBooking: (b: { id: string }) => ({ id: b.id }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const get = (query = "") => GET(new NextRequest(`http://localhost/api/meetings/scheduling/bookings${query}`));

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "host-1", orgId: "org-1" } });
  listBookingsForHost.mockResolvedValue([{ id: "bk-1" }]);
});

it("refuses a caller without a session", async () => {
  authMock.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
  expect((await get()).status).toBe(401);
  expect(listBookingsForHost).not.toHaveBeenCalled();
});

it("lists the caller's pending requests over the window asked for", async () => {
  const to = "2099-12-01T00:00:00.000Z";
  const res = await get(`?from=2099-10-01T00:00:00.000Z&to=${to}`);
  expect(await res.json()).toEqual({ requests: [{ id: "bk-1" }] });
  expect(listBookingsForHost).toHaveBeenCalledWith(expect.anything(), "host-1", expect.objectContaining({
    statuses: ["pending"],
    fromIso: "2099-10-01T00:00:00.000Z",
    toIso: to,
  }));
});

it("never reaches back before now, and ignores a malformed window", async () => {
  await get("?from=2000-01-01T00:00:00.000Z&to=soon");
  expect(listBookingsForHost.mock.calls[0][2]).toMatchObject({ fromIso: undefined, toIso: undefined });
});
