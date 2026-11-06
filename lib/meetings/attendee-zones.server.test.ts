import { loadAttendeeZones } from "./attendee-zones.server";

function client(tables: Record<string, { data: unknown; error?: unknown } | Error>) {
  return {
    from: (name: string) => {
      const result = tables[name];
      const b: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "not", "order", "limit"]) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        result instanceof Error ? reject(result) : resolve({ data: result?.data ?? null, error: result?.error ?? null });
      return b;
    },
  } as never;
}

it("prefers a teammate's own meetings to a booking, and lower-cases addresses", async () => {
  const zones = await loadAttendeeZones(
    client({
      principals: { data: [{ id: "u1", email: "Ana@Fund.test" }] },
      live_meetings: { data: [{ host_id: "u1", timezone: "Europe/London" }] },
      scheduling_bookings: {
        data: [
          { invitee_email: "ana@fund.test", invitee_timezone: "Asia/Tokyo" },
          { invitee_email: "lp@out.test", invitee_timezone: "America/Chicago" },
        ],
      },
    }),
    "org-1",
    ["ANA@fund.test", "lp@out.test", "not-an-email"],
  );
  expect(zones).toEqual({ "ana@fund.test": "Europe/London", "lp@out.test": "America/Chicago" });
});

it("returns what it can when one source fails, and nothing for no addresses", async () => {
  const zones = await loadAttendeeZones(
    client({
      principals: new Error("down"),
      scheduling_bookings: { data: [{ invitee_email: "lp@out.test", invitee_timezone: "America/Chicago" }] },
    }),
    "org-1",
    ["lp@out.test"],
  );
  expect(zones).toEqual({ "lp@out.test": "America/Chicago" });
  expect(await loadAttendeeZones(client({}), "org-1", [])).toEqual({});
});
