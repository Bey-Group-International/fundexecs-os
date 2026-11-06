import { firstZoneByEmail, guestTimes, hoursFlag, zoneCity, zoneClock } from "./attendee-zones";

// 13:00Z on a November Monday: 8am New York, 1pm London, 9pm Singapore.
const START = "2026-11-09T13:00:00.000Z";

describe("guestTimes", () => {
  const guests = [
    { email: "ny@x.test", name: "Nia" },
    { email: "LDN@x.test", name: "Leo" },
    { email: "sg@x.test", name: "Sam" },
    { email: "unknown@x.test", name: "Una" },
  ];
  const zones = { "ny@x.test": "America/New_York", "ldn@x.test": "Europe/London", "sg@x.test": "Asia/Singapore" };

  it("gives each guest the start in their own time, flagging early and late", () => {
    const out = guestTimes(START, "America/New_York", guests, zones);
    // Nia shares the meeting's zone and needs no line; Una's zone is unknown.
    expect(out.map((g) => [g.name, g.clock, g.city, g.flag])).toEqual([
      ["Leo", "1:00 PM", "London", null],
      ["Sam", "9:00 PM", "Singapore", "late"],
    ]);
  });

  it("says nothing for a start that is not a time yet", () => {
    expect(guestTimes("nope", "UTC", guests, zones)).toEqual([]);
  });
});

describe("the pieces", () => {
  it("names a zone by its city", () => {
    expect(zoneCity("America/New_York")).toBe("New York");
    expect(zoneCity("UTC")).toBe("UTC");
  });

  it("flags before 8 and from 7pm", () => {
    expect(hoursFlag("2026-11-09T07:59:00Z", "UTC")).toBe("early");
    expect(hoursFlag("2026-11-09T08:00:00Z", "UTC")).toBeNull();
    expect(hoursFlag("2026-11-09T19:00:00Z", "UTC")).toBe("late");
  });

  it("falls back to the UTC clock for an unknown zone", () => {
    expect(zoneClock(START, "Mars/Base")).toBe("13:00");
  });

  it("keeps the first valid zone per address, newest rows first", () => {
    expect(
      firstZoneByEmail(
        [
          { email: "A@x.test", timezone: "Bad/Zone" },
          { email: "a@x.test", timezone: "Europe/Paris" },
          { email: "a@x.test", timezone: "Asia/Tokyo" },
          { email: null, timezone: "UTC" },
        ],
        (tz) => tz !== "Bad/Zone",
      ),
    ).toEqual({ "a@x.test": "Europe/Paris" });
  });
});
