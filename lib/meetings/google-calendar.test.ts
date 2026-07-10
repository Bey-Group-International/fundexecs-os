import { toGCalDate, buildGoogleCalendarTemplateUrl } from "./google-calendar";

describe("google-calendar", () => {
  it("formats a UTC instant as a Google Calendar datetime", () => {
    expect(toGCalDate(new Date("2026-07-10T14:30:00.000Z"))).toBe("20260710T143000Z");
  });

  it("builds a TEMPLATE url with computed end time", () => {
    const url = buildGoogleCalendarTemplateUrl({
      title: "Q3 LP Review",
      startIso: "2026-07-10T14:00:00.000Z",
      durationMinutes: 90,
    })!;
    expect(url).toContain("https://calendar.google.com/calendar/render?");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("text=Q3+LP+Review");
    expect(url).toContain("dates=20260710T140000Z%2F20260710T153000Z");
  });

  it("defaults to 60 minutes and includes details, location, and guests", () => {
    const url = buildGoogleCalendarTemplateUrl({
      title: "Sync",
      startIso: "2026-07-10T14:00:00.000Z",
      details: "Join: https://x.test",
      location: "Room 1",
      guests: ["a@fund.com", "not-an-email", "b@fund.com"],
    })!;
    expect(url).toContain("dates=20260710T140000Z%2F20260710T150000Z");
    expect(url).toContain("details=Join");
    expect(url).toContain("location=Room+1");
    // Only valid emails are added.
    expect(url).toContain("add=a%40fund.com%2Cb%40fund.com");
  });

  it("returns null for an invalid start time", () => {
    expect(buildGoogleCalendarTemplateUrl({ title: "x", startIso: "not-a-date" })).toBeNull();
  });
});
