// The point of a block: an invitee stops being offered that time.
//
// This composes the two halves that make it true — blocksToBusyIntervals, and
// the slot engine that consumes busy intervals — so the promise is verified
// end to end without a database.
import { blocksToBusyIntervals } from "./blocks";
import { DEFAULT_AVAILABILITY, generateSlots, isSlotAvailable } from "./scheduling";

const MONDAY = "2026-03-02"; // a Monday, so DEFAULT_AVAILABILITY applies
const NOW = new Date("2026-03-01T00:00:00Z");

const base = {
  timezone: "UTC",
  availability: DEFAULT_AVAILABILITY,
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  busy: [],
  now: NOW,
};

const AFTERNOON_BLOCK = [
  { starts_at: "2026-03-02T13:00:00.000Z", ends_at: "2026-03-02T15:00:00.000Z" },
];

describe("a block removes the time from the booking link", () => {
  it("drops every slot inside the blocked span", () => {
    const open = generateSlots({ ...base, fromDate: MONDAY, toDate: MONDAY });
    const withBlock = generateSlots({
      ...base,
      fromDate: MONDAY,
      toDate: MONDAY,
      busy: blocksToBusyIntervals(AFTERNOON_BLOCK),
    });

    expect(open.length).toBeGreaterThan(withBlock.length);
    const blockedStarts = withBlock.filter((s) => {
      const t = new Date(s.start).getTime();
      return t >= Date.parse("2026-03-02T13:00:00Z") && t < Date.parse("2026-03-02T15:00:00Z");
    });
    expect(blockedStarts).toEqual([]);
  });

  it("leaves the rest of the day bookable", () => {
    const withBlock = generateSlots({
      ...base,
      fromDate: MONDAY,
      toDate: MONDAY,
      busy: blocksToBusyIntervals(AFTERNOON_BLOCK),
    });
    // 09:00 is well clear of a 13:00–15:00 block.
    expect(withBlock.some((s) => s.start === "2026-03-02T09:00:00.000Z")).toBe(true);
  });

  it("refuses a direct booking attempt on a blocked slot", () => {
    // The slot list is only half the defence — a hand-crafted request for a
    // blocked time has to be rejected too.
    const busy = blocksToBusyIntervals(AFTERNOON_BLOCK);
    expect(isSlotAvailable("2026-03-02T13:00:00.000Z", { ...base, busy })).toBe(false);
    expect(isSlotAvailable("2026-03-02T14:30:00.000Z", { ...base, busy })).toBe(false);
    expect(isSlotAvailable("2026-03-02T09:00:00.000Z", { ...base, busy })).toBe(true);
  });

  it("frees the slot that starts exactly when the block ends", () => {
    // Half-open intervals: a 15:00 slot after a block ending 15:00 is bookable.
    const busy = blocksToBusyIntervals(AFTERNOON_BLOCK);
    expect(isSlotAvailable("2026-03-02T15:00:00.000Z", { ...base, busy })).toBe(true);
  });

  it("changes nothing on a day the block does not touch", () => {
    const busy = blocksToBusyIntervals(AFTERNOON_BLOCK);
    const tuesday = generateSlots({ ...base, fromDate: "2026-03-03", toDate: "2026-03-03", busy });
    const untouched = generateSlots({ ...base, fromDate: "2026-03-03", toDate: "2026-03-03" });
    expect(tuesday.length).toBe(untouched.length);
  });
});
