const authMock = jest.fn();
const loadExternalConflictsMock = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
jest.mock("@/lib/meetings/conflicts.server", () => ({
  loadExternalConflicts: (...args: unknown[]) => loadExternalConflictsMock(...args),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/meetings/busy?${query}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "o1", userId: "u1" } });
  loadExternalConflictsMock.mockResolvedValue([]);
});

it("answers with the member's busy time in the window", async () => {
  const busy = [{ start: "2026-09-10T14:00:00.000Z", end: "2026-09-10T14:30:00.000Z" }];
  loadExternalConflictsMock.mockResolvedValue(busy);

  const res = await get("start=2026-09-10T14:00:00.000Z&end=2026-09-10T15:00:00.000Z&tz=America/Chicago");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ busy });
  expect(loadExternalConflictsMock).toHaveBeenCalledWith(expect.anything(), {
    userId: "u1",
    startIso: "2026-09-10T14:00:00.000Z",
    endIso: "2026-09-10T15:00:00.000Z",
    timezone: "America/Chicago",
  });
});

it("refuses a window that is backwards, missing or longer than a day", async () => {
  for (const q of [
    "start=2026-09-10T15:00:00Z&end=2026-09-10T14:00:00Z",
    "start=nope&end=2026-09-10T14:00:00Z",
    "start=2026-09-10T00:00:00Z&end=2026-09-12T00:00:00Z",
  ]) {
    expect((await get(q)).status).toBe(400);
  }
  expect(loadExternalConflictsMock).not.toHaveBeenCalled();
});

it("needs a signed-in member", async () => {
  authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
  expect((await get("start=2026-09-10T14:00:00Z&end=2026-09-10T15:00:00Z")).status).toBe(401);
});

it("falls back to UTC for a zone it does not know", async () => {
  await get("start=2026-09-10T14:00:00Z&end=2026-09-10T15:00:00Z&tz=Mars/Olympus");
  expect(loadExternalConflictsMock.mock.calls[0][1].timezone).toBe("UTC");
});
