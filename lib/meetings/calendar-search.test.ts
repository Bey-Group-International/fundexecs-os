import { searchMeetings } from "./calendar-search";

const NOW = new Date("2026-11-06T12:00:00Z").getTime();
const M = (id: string, title: string, at: string, attendees: unknown = []) => ({
  id,
  title,
  scheduled_at: at,
  duration_minutes: 30,
  attendees,
});

const meetings = [
  M("past-old", "Acme diligence", "2026-09-01T10:00:00Z"),
  M("past-new", "Acme follow-up", "2026-11-01T10:00:00Z"),
  M("soon", "LP update", "2026-11-07T10:00:00Z", [{ name: "Ana Ruiz", email: "ana@acme.com" }]),
  M("later", "Acme board", "2026-11-20T10:00:00Z"),
  M("gmail", "Coffee", "2026-11-08T10:00:00Z", [{ name: "Bo", email: "bo@gmail.com" }]),
];

it("puts upcoming first, title matches above company matches, then soonest", () => {
  const ids = searchMeetings(meetings, "acme", NOW).map((h) => h.meeting.id);
  expect(ids).toEqual(["later", "soon", "past-new", "past-old"]);
});

it("finds a person by name or address and says who matched", () => {
  const [hit] = searchMeetings(meetings, "ruiz", NOW);
  expect(hit.meeting.id).toBe("soon");
  expect(hit.matched).toBe("Ana Ruiz");
  expect(searchMeetings(meetings, "acme.com", NOW).find((x) => x.meeting.id === "soon")?.matched).toBe("acme.com");
});

it("needs every word to match somewhere, ignoring case and accents", () => {
  expect(searchMeetings(meetings, "ACME board", NOW).map((h) => h.meeting.id)).toEqual(["later"]);
  expect(searchMeetings(meetings, "acme zebra", NOW)).toEqual([]);
  expect(searchMeetings([M("x", "Révision", "2026-11-09T10:00:00Z")], "revision", NOW)).toHaveLength(1);
});

it("does not treat a personal mail host as a company", () => {
  expect(searchMeetings(meetings, "gmail", NOW)).toEqual([]);
});

it("waits for two characters and survives junk attendees", () => {
  expect(searchMeetings(meetings, "a", NOW)).toEqual([]);
  expect(searchMeetings([M("j", "Sync", "2026-11-09T10:00:00Z", "junk")], "sync", NOW)).toHaveLength(1);
});
