import {
  DEFAULT_AVAILABILITY,
  addCalendarDays,
  bookingWindowRange,
  dateInTimezone,
  datesBetween,
  generateSlots,
  groupSlotsByDate,
  isReservedSlug,
  isSlotAvailable,
  isValidTimezone,
  mergeAvailability,
  normalizeSlug,
  parseAvailability,
  suggestSlug,
  validateBookingRequest,
  weekdayOfDate,
  buildBookingManageUrl,
  buildBookingPageUrl,
} from "./scheduling";

// 2026-03-02 is a Monday. All fixtures anchor here so weekday math is explicit.
const MONDAY = "2026-03-02";
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

describe("normalizeSlug", () => {
  it("lowercases, strips punctuation and collapses separators", () => {
    expect(normalizeSlug("  Sheikas  Simmons-Bey! ")).toBe("sheikas-simmons-bey");
    expect(normalizeSlug("A..B__C")).toBe("a-b-c");
  });

  it("returns empty when nothing usable survives", () => {
    expect(normalizeSlug("!!!")).toBe("");
  });

  it("never ends in a hyphen after truncation", () => {
    expect(normalizeSlug("a".repeat(39) + " tail")).not.toMatch(/-$/);
  });
});

describe("suggestSlug", () => {
  it("prefers the display name, then the email local part, then the user id", () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    expect(suggestSlug({ displayName: "Ada Lovelace", email: "ada@x.com", userId })).toBe("ada-lovelace");
    expect(suggestSlug({ displayName: "", email: "ada.l@x.com", userId })).toBe("ada-l");
    expect(suggestSlug({ displayName: null, email: null, userId })).toBe("member-11111111");
  });
});

describe("isReservedSlug", () => {
  it("blocks handles that would shadow a real route", () => {
    expect(isReservedSlug("booking")).toBe(true);
    expect(isReservedSlug("sheikas")).toBe(false);
  });
});

describe("parseAvailability", () => {
  it("drops malformed rules instead of throwing", () => {
    expect(
      parseAvailability([
        { day: 1, start: "09:00", end: "17:00" },
        { day: 9, start: "09:00", end: "17:00" }, // out of range
        { day: 2, start: "25:00", end: "26:00" }, // not a time
        { day: 3, start: "17:00", end: "09:00" }, // inverted
        "nonsense",
      ]),
    ).toEqual([{ day: 1, start: "09:00", end: "17:00" }]);
  });

  it("returns empty for non-array input", () => {
    expect(parseAvailability(null)).toEqual([]);
    expect(parseAvailability({ day: 1 })).toEqual([]);
  });
});

describe("mergeAvailability", () => {
  it("merges overlapping and touching windows on the same day", () => {
    expect(
      mergeAvailability([
        { day: 1, start: "09:00", end: "12:00" },
        { day: 1, start: "11:00", end: "13:00" },
        { day: 1, start: "13:00", end: "14:00" },
        { day: 2, start: "09:00", end: "10:00" },
      ]),
    ).toEqual([
      { day: 1, start: "09:00", end: "14:00" },
      { day: 2, start: "09:00", end: "10:00" },
    ]);
  });

  it("keeps genuinely separate windows apart", () => {
    expect(
      mergeAvailability([
        { day: 1, start: "09:00", end: "12:00" },
        { day: 1, start: "13:00", end: "17:00" },
      ]),
    ).toHaveLength(2);
  });
});

describe("calendar date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("reads weekday from a bare calendar date", () => {
    expect(weekdayOfDate(MONDAY)).toBe(1);
    expect(weekdayOfDate("2026-03-08")).toBe(0);
  });

  it("lists an inclusive range and caps runaway ranges", () => {
    expect(datesBetween("2026-03-01", "2026-03-04")).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
    ]);
    expect(datesBetween("2026-01-01", "2030-01-01")).toHaveLength(400);
  });

  it("reads the local date in a zone, not UTC's", () => {
    // 23:30 UTC is already the next day in Tokyo.
    expect(dateInTimezone(new Date("2026-03-02T23:30:00Z"), "Asia/Tokyo")).toBe("2026-03-03");
    expect(dateInTimezone(new Date("2026-03-02T23:30:00Z"), "UTC")).toBe("2026-03-02");
  });
});

describe("generateSlots", () => {
  it("walks the working window at the slot interval", () => {
    const slots = generateSlots({ ...base, fromDate: MONDAY, toDate: MONDAY });
    // 09:00–17:00 in 30-minute steps = 16 slots.
    expect(slots).toHaveLength(16);
    expect(slots[0].start).toBe("2026-03-02T09:00:00.000Z");
    expect(slots[0].end).toBe("2026-03-02T09:30:00.000Z");
    expect(slots[slots.length - 1].start).toBe("2026-03-02T16:30:00.000Z");
  });

  it("never offers a slot that would run past the window", () => {
    const slots = generateSlots({
      ...base,
      durationMinutes: 45,
      slotIntervalMinutes: 45,
      availability: [{ day: 1, start: "09:00", end: "10:00" }],
      fromDate: MONDAY,
      toDate: MONDAY,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].end).toBe("2026-03-02T09:45:00.000Z");
  });

  it("skips days with no rule", () => {
    // 2026-03-07 is a Saturday; the default rules are weekdays only.
    expect(generateSlots({ ...base, fromDate: "2026-03-07", toDate: "2026-03-08" })).toHaveLength(0);
  });

  it("removes slots that collide with a busy interval", () => {
    const slots = generateSlots({
      ...base,
      busy: [{ start: "2026-03-02T10:00:00Z", end: "2026-03-02T11:00:00Z" }],
      fromDate: MONDAY,
      toDate: MONDAY,
    });
    const starts = slots.map((s) => s.start);
    expect(starts).not.toContain("2026-03-02T10:00:00.000Z");
    expect(starts).not.toContain("2026-03-02T10:30:00.000Z");
    expect(starts).toContain("2026-03-02T09:30:00.000Z");
    expect(starts).toContain("2026-03-02T11:00:00.000Z");
  });

  it("keeps the buffer clear on both sides of a booking", () => {
    const starts = generateSlots({
      ...base,
      bufferMinutes: 15,
      busy: [{ start: "2026-03-02T10:00:00Z", end: "2026-03-02T10:30:00Z" }],
      fromDate: MONDAY,
      toDate: MONDAY,
    }).map((s) => s.start);
    // The 09:30 slot ends at 10:00 and the 10:30 slot starts at 10:30 — both are
    // inside the 15-minute pad, so neither may be offered.
    expect(starts).not.toContain("2026-03-02T09:30:00.000Z");
    expect(starts).not.toContain("2026-03-02T10:30:00.000Z");
    expect(starts).toContain("2026-03-02T09:00:00.000Z");
    expect(starts).toContain("2026-03-02T11:00:00.000Z");
  });

  it("honours the minimum notice", () => {
    const slots = generateSlots({
      ...base,
      now: new Date("2026-03-02T09:00:00Z"),
      minNoticeMinutes: 120,
      fromDate: MONDAY,
      toDate: MONDAY,
    });
    expect(slots[0].start).toBe("2026-03-02T11:00:00.000Z");
  });

  it("interprets working hours in the host's zone, not the server's", () => {
    const slots = generateSlots({
      ...base,
      timezone: "America/New_York",
      availability: [{ day: 1, start: "09:00", end: "10:00" }],
      fromDate: MONDAY,
      toDate: MONDAY,
    });
    // 09:00 EST (UTC-5) on 2026-03-02 is 14:00Z.
    expect(slots[0].start).toBe("2026-03-02T14:00:00.000Z");
  });

  it("holds wall-clock hours steady across a DST transition", () => {
    // US DST starts 2026-03-08; 2026-03-09 is the Monday after.
    const before = generateSlots({
      ...base,
      timezone: "America/New_York",
      availability: [{ day: 1, start: "09:00", end: "10:00" }],
      fromDate: MONDAY,
      toDate: MONDAY,
    });
    const after = generateSlots({
      ...base,
      timezone: "America/New_York",
      availability: [{ day: 1, start: "09:00", end: "10:00" }],
      fromDate: "2026-03-09",
      toDate: "2026-03-09",
    });
    expect(before[0].start).toBe("2026-03-02T14:00:00.000Z"); // EST
    expect(after[0].start).toBe("2026-03-09T13:00:00.000Z"); // EDT — still 09:00 local
  });

  it("returns slots in ascending order across days", () => {
    const slots = generateSlots({ ...base, fromDate: MONDAY, toDate: "2026-03-04" });
    const starts = slots.map((s) => s.start);
    expect([...starts].sort()).toEqual(starts);
    expect(slots).toHaveLength(48);
  });
});

describe("isSlotAvailable", () => {
  const input = { ...base };

  it("accepts a slot the engine offers", () => {
    expect(isSlotAvailable("2026-03-02T09:00:00.000Z", input)).toBe(true);
  });

  it("rejects an off-grid time, a busy time and a past time", () => {
    expect(isSlotAvailable("2026-03-02T09:07:00.000Z", input)).toBe(false);
    expect(
      isSlotAvailable("2026-03-02T09:00:00.000Z", {
        ...input,
        busy: [{ start: "2026-03-02T09:00:00Z", end: "2026-03-02T09:30:00Z" }],
      }),
    ).toBe(false);
    expect(isSlotAvailable("2026-02-02T09:00:00.000Z", input)).toBe(false);
  });

  it("rejects a malformed instant", () => {
    expect(isSlotAvailable("not-a-date", input)).toBe(false);
  });

  it("finds a slot that falls on an adjacent host-local date", () => {
    // 00:30 Tokyo on the 3rd is 15:30Z on the 2nd — the host-local date and the
    // instant's UTC date disagree, so the ±1 day sweep has to catch it.
    expect(
      isSlotAvailable("2026-03-02T15:30:00.000Z", {
        ...input,
        timezone: "Asia/Tokyo",
        availability: [{ day: 2, start: "00:00", end: "01:00" }],
      }),
    ).toBe(true);
  });
});

describe("isValidTimezone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Asia/Tokyo")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("rejects anything this runtime cannot resolve", () => {
    // A bogus zone stored on a page would silently generate every slot in UTC,
    // so it must never survive validation.
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("America/Nowhere")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("   ")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
    expect(isValidTimezone(42)).toBe(false);
  });
});

describe("bookingWindowRange", () => {
  it("starts today in the host's zone and ends at the window", () => {
    const range = bookingWindowRange({ now: NOW, timezone: "UTC", bookingWindowDays: 30 });
    expect(range).toEqual({ fromDate: "2026-03-01", toDate: "2026-03-31" });
  });

  it("clamps a caller's range to the window", () => {
    const range = bookingWindowRange({
      now: NOW,
      timezone: "UTC",
      bookingWindowDays: 7,
      fromDate: "2026-02-01", // in the past → ignored
      toDate: "2026-12-01", // beyond the window → clamped
    });
    expect(range).toEqual({ fromDate: "2026-03-01", toDate: "2026-03-08" });
  });

  it("never returns an inverted range", () => {
    const range = bookingWindowRange({
      now: NOW,
      timezone: "UTC",
      bookingWindowDays: 30,
      fromDate: "2026-03-20",
      toDate: "2026-03-10",
    });
    expect(range.toDate).toBe(range.fromDate);
  });
});

describe("groupSlotsByDate", () => {
  it("buckets slots by the viewer's local date", () => {
    const slots = [
      { start: "2026-03-02T22:00:00.000Z", end: "2026-03-02T22:30:00.000Z" },
      { start: "2026-03-02T23:00:00.000Z", end: "2026-03-02T23:30:00.000Z" },
    ];
    expect(groupSlotsByDate(slots, "UTC")).toEqual([{ date: "2026-03-02", slots }]);
    // Both are already the 3rd in Tokyo.
    expect(groupSlotsByDate(slots, "Asia/Tokyo")[0].date).toBe("2026-03-03");
  });
});

describe("validateBookingRequest", () => {
  it("passes a complete request", () => {
    expect(
      validateBookingRequest({ name: "Ada", email: "ada@x.com", startIso: "2026-03-02T09:00:00Z" }),
    ).toEqual({});
  });

  it("flags each missing or malformed field", () => {
    const errors = validateBookingRequest({ name: "  ", email: "nope", startIso: "bad" });
    expect(errors.name).toBeTruthy();
    expect(errors.email).toBeTruthy();
    expect(errors.slot).toBeTruthy();
  });
});

describe("public URLs", () => {
  it("builds page, event and manage links without doubling slashes", () => {
    expect(buildBookingPageUrl("https://fundexecs.com/", "ada")).toBe("https://fundexecs.com/book/ada");
    expect(buildBookingPageUrl("https://fundexecs.com", "ada", "intro-15")).toBe(
      "https://fundexecs.com/book/ada/intro-15",
    );
    expect(buildBookingManageUrl("https://fundexecs.com/", "tok")).toBe("https://fundexecs.com/booking/tok");
  });
});
