const hostMock = jest.fn();
jest.mock("../host.server", () => ({ requireMeetingHost: () => hostMock() }));
jest.mock("@/lib/meetings/follow-up-sends.server", () => ({
  loadSends: async () => ({
    available: true,
    rows: [{ id: "s1", email: "ana@x.com", name: "Ana", status: "failed", scheduled_for: null, sent_at: null, error: "bounced", nudge_after_days: null, nudged_at: null, replied_at: null, created_at: "2026-11-06T10:00:00Z" }],
  }),
  hostBookingSlug: async () => "hana",
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

it("lists each recipient's delivery with the booking link", async () => {
  hostMock.mockResolvedValue({ ok: true, userId: "u1", email: "h@x.com", db: {} });
  const body = await (await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: "m1" }) })).json();
  expect(body.lines).toEqual([expect.objectContaining({ email: "ana@x.com", state: "failed", error: "bounced" })]);
  expect(body.bookingUrl).toMatch(/\/book\/hana$/);
  expect(body.hostEmail).toBe("h@x.com");
});
