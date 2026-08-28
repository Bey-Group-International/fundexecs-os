// Who hears that a meeting was scheduled. The host used to hear nothing, on the
// theory that they already knew — but the confirmation is also what puts the
// meeting in their own calendar.
import {
  canInviteToCalendar,
  inviteEndIso,
  scheduledRecipients,
} from "./scheduled-invite";

describe("scheduledRecipients", () => {
  it("includes the host, and puts them first", () => {
    const out = scheduledRecipients("rae@fund.test", "Rae Bey", ["ada@example.com"]);
    expect(out.map((r) => r.email)).toEqual(["rae@fund.test", "ada@example.com"]);
    expect(out[0]).toMatchObject({ role: "host", name: "Rae Bey" });
    expect(out[1].role).toBe("guest");
  });

  it("emails the host even when there are no guests", () => {
    // A meeting with no attendees is still a meeting, and it still belongs in
    // the host's calendar.
    const out = scheduledRecipients("rae@fund.test", "Rae Bey", []);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("host");
  });

  it("does not email a host twice who is also on the guest list", () => {
    // Two emails saying different things about one meeting is worse than one.
    const out = scheduledRecipients("rae@fund.test", "Rae", ["RAE@fund.test", "ada@example.com"]);
    expect(out.map((r) => r.email)).toEqual(["rae@fund.test", "ada@example.com"]);
    expect(out[0].role).toBe("host");
  });

  it("still reaches the guests when there is no host address", () => {
    const out = scheduledRecipients(null, null, ["ada@example.com"]);
    expect(out).toEqual([{ name: "ada", email: "ada@example.com", role: "guest" }]);
  });

  it("drops anything that is not an address", () => {
    const out = scheduledRecipients("  ", null, ["not-an-email", "", "  ", "bo@example.com"]);
    expect(out.map((r) => r.email)).toEqual(["bo@example.com"]);
  });

  it("falls back to the address for a missing display name", () => {
    expect(scheduledRecipients("rae@fund.test", "   ", [])[0].name).toBe("rae");
  });
});

describe("canInviteToCalendar", () => {
  const ok = { meetingId: "m1", startIso: "2026-09-10T15:00:00.000Z", hostEmail: "rae@fund.test" };

  it("needs an id, a host and a real time", () => {
    expect(canInviteToCalendar(ok)).toBe(true);
    expect(canInviteToCalendar({ ...ok, meetingId: null })).toBe(false);
    expect(canInviteToCalendar({ ...ok, hostEmail: null })).toBe(false);
    expect(canInviteToCalendar({ ...ok, startIso: null })).toBe(false);
  });

  it("refuses a time that is not one", () => {
    // An unparseable date would throw inside the .ics builder and take the
    // whole email with it.
    expect(canInviteToCalendar({ ...ok, startIso: "nonsense" })).toBe(false);
  });
});

describe("inviteEndIso", () => {
  it("adds the meeting's length", () => {
    expect(inviteEndIso("2026-09-10T15:00:00.000Z", 30)).toBe("2026-09-10T15:30:00.000Z");
  });

  it("gives an unstated length an hour rather than no duration", () => {
    // A zero-length event is rejected outright by some clients.
    expect(inviteEndIso("2026-09-10T15:00:00.000Z", null)).toBe("2026-09-10T16:00:00.000Z");
    expect(inviteEndIso("2026-09-10T15:00:00.000Z", 0)).toBe("2026-09-10T16:00:00.000Z");
    expect(inviteEndIso("2026-09-10T15:00:00.000Z", -5)).toBe("2026-09-10T16:00:00.000Z");
  });
});
