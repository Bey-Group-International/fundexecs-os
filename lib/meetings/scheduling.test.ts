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
  BOOKING_EMAIL_MAX,
  BOOKING_NAME_MAX,
  BOOKING_NOTES_MAX,
  BOOKING_REASON_MAX,
  BOOKING_GUESTS_MAX,
  parseBookingGuests,
  normalizeBookingReason,
  weekdayOfDate,
  buildBookingManageUrl,
  buildBookingPageUrl,
  bookingPrefillQuery,
  parseBookingPrefill,
  formatSlotDate,
  formatSlotDayMonth,
  formatSlotFull,
  formatSlotTime,
  formatSlotWeekday,
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

describe("generateSlots daily booking limit", () => {
  it("stops offering a day once it holds the limit", () => {
    const slots = generateSlots({
      ...base,
      maxBookingsPerDay: 2,
      bookingStarts: ["2026-03-02T09:00:00Z", "2026-03-02T14:00:00Z"],
      fromDate: MONDAY,
      toDate: "2026-03-03",
    });
    expect(slots.some((s) => s.start.startsWith("2026-03-02"))).toBe(false);
    expect(slots.filter((s) => s.start.startsWith("2026-03-03"))).toHaveLength(16);
  });

  it("keeps offering a day still under the limit", () => {
    const slots = generateSlots({
      ...base,
      maxBookingsPerDay: 2,
      bookingStarts: ["2026-03-02T09:00:00Z"],
      fromDate: MONDAY,
      toDate: MONDAY,
    });
    expect(slots).toHaveLength(16);
  });

  it("counts bookings by the host's local date, not UTC's", () => {
    // 23:30Z on the 1st is already Monday the 2nd in Tokyo.
    const slots = generateSlots({
      ...base,
      timezone: "Asia/Tokyo",
      maxBookingsPerDay: 1,
      bookingStarts: ["2026-03-01T23:30:00Z"],
      fromDate: MONDAY,
      toDate: MONDAY,
    });
    expect(slots).toHaveLength(0);
  });

  it("ignores the limit when it is unset or not positive", () => {
    const bookingStarts = ["2026-03-02T09:00:00Z"];
    for (const maxBookingsPerDay of [null, undefined, 0]) {
      expect(generateSlots({ ...base, maxBookingsPerDay, bookingStarts, fromDate: MONDAY, toDate: MONDAY })).toHaveLength(16);
    }
  });

  it("is enforced by isSlotAvailable too", () => {
    const input = { ...base, maxBookingsPerDay: 1, bookingStarts: ["2026-03-02T15:00:00Z"] };
    expect(isSlotAvailable("2026-03-02T09:00:00.000Z", input)).toBe(false);
    expect(isSlotAvailable("2026-03-03T09:00:00.000Z", input)).toBe(true);
  });
});

describe("parseBookingGuests", () => {
  it("reads a pasted list, lowercased and deduplicated, without the invitee", () => {
    expect(parseBookingGuests("Grace@Example.com, alan@example.com; grace@example.com ada@example.com", "ADA@example.com")).toEqual({
      guests: ["grace@example.com", "alan@example.com"],
    });
    expect(parseBookingGuests(["grace@example.com"], "ada@example.com")).toEqual({ guests: ["grace@example.com"] });
  });

  it("is empty when nothing was given", () => {
    for (const raw of [undefined, null, "", "  ,  "]) {
      expect(parseBookingGuests(raw, "ada@example.com")).toEqual({ guests: [] });
    }
  });

  it("refuses a bad address rather than dropping it", () => {
    expect(parseBookingGuests("grace@example.com, not-an-email", "ada@example.com")).toEqual({
      error: expect.stringContaining("not-an-email"),
    });
    expect(parseBookingGuests(42, "ada@example.com")).toHaveProperty("error");
    expect(parseBookingGuests([42], "ada@example.com")).toHaveProperty("error");
  });

  it("caps the list", () => {
    const many = Array.from({ length: BOOKING_GUESTS_MAX + 1 }, (_, i) => `g${i}@example.com`);
    expect(parseBookingGuests(many, "ada@example.com")).toHaveProperty("error");
    expect(parseBookingGuests(many.slice(0, BOOKING_GUESTS_MAX), "ada@example.com")).toEqual({ guests: many.slice(0, BOOKING_GUESTS_MAX) });
  });
});

describe("normalizeBookingReason", () => {
  it("keeps text, trimmed", () => {
    expect(normalizeBookingReason("  running late  ")).toBe("running late");
  });

  it("is null for blanks and anything that is not text", () => {
    for (const raw of ["", "   ", null, undefined, 42, { text: "x" }, ["x"], true]) {
      expect(normalizeBookingReason(raw)).toBeNull();
    }
  });

  it("caps a long reason", () => {
    expect(normalizeBookingReason("x".repeat(BOOKING_REASON_MAX + 500))).toHaveLength(BOOKING_REASON_MAX);
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
  // The bucket used to be rebuilt for every slot appended to it, which is
  // quadratic in the size of the biggest day — and the biggest day is the whole
  // list when a host opens one long window. The rewrite pushes instead. Only the
  // result is assertable here; the complexity is in the pull request.
  it("keeps every slot, in order, when they all land on the same day", () => {
    const slots = Array.from({ length: 200 }, (_, i) => {
      const start = Date.UTC(2026, 2, 2, 0, 0) + i * 5 * 60_000;
      return { start: new Date(start).toISOString(), end: new Date(start + 300_000).toISOString() };
    });
    const grouped = groupSlotsByDate(slots, "UTC");
    expect(grouped).toHaveLength(1);
    expect(grouped[0].slots).toEqual(slots);
  });

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

  it("caps every free-text field, so one public request can't store megabytes", () => {
    const ok = { name: "Ada", email: "ada@x.com", startIso: "2026-03-02T09:00:00Z" };
    expect(validateBookingRequest({ ...ok, name: "A".repeat(BOOKING_NAME_MAX) })).toEqual({});
    expect(validateBookingRequest({ ...ok, name: "A".repeat(BOOKING_NAME_MAX + 1) }).name).toBeTruthy();
    expect(
      validateBookingRequest({ ...ok, email: `${"a".repeat(BOOKING_EMAIL_MAX)}@x.com` }).email,
    ).toBeTruthy();
    expect(validateBookingRequest({ ...ok, notes: "n".repeat(BOOKING_NOTES_MAX) })).toEqual({});
    expect(validateBookingRequest({ ...ok, notes: "n".repeat(BOOKING_NOTES_MAX + 1) }).notes).toBeTruthy();
    // Notes may be absent entirely.
    expect(validateBookingRequest({ ...ok, notes: null })).toEqual({});
  });

  it("rejects a name carrying a header break", () => {
    // This is the booking-form end of the mail header injection: the name
    // reaches the host's subject line. lib/email-headers.ts makes it harmless
    // on the wire; this stops it being stored and shown in the app at all.
    const errors = validateBookingRequest({
      name: "Bob\r\nBcc: attacker@evil.test",
      email: "bob@x.com",
      startIso: "2026-03-02T09:00:00Z",
    });
    expect(errors.name).toBeTruthy();
  });

  it("rejects a bare newline as well as a CRLF", () => {
    expect(
      validateBookingRequest({ name: "Bob\nBcc: x@evil.test", email: "b@x.com", startIso: "2026-03-02T09:00:00Z" }).name,
    ).toBeTruthy();
  });

  it("rejects other control characters in a name", () => {
    expect(
      validateBookingRequest({ name: "Bob\u0007", email: "b@x.com", startIso: "2026-03-02T09:00:00Z" }).name,
    ).toBeTruthy();
  });

  it("rejects a control character in an email", () => {
    expect(
      validateBookingRequest({ name: "Bob", email: "b@x.com\u0000", startIso: "2026-03-02T09:00:00Z" }).email,
    ).toBeTruthy();
  });

  it("still accepts ordinary names with punctuation and accents", () => {
    // The check is for control characters, not for anything that looks unusual
    // to an English reader — a name is not a place to be clever about what is
    // allowed.
    for (const name of ["Ada Lovelace", "O'Neill", "Jean-Luc", "Müller", "李雷", "Simmons, Bey"]) {
      expect(
        validateBookingRequest({ name, email: "a@x.com", startIso: "2026-03-02T09:00:00Z" }),
      ).toEqual({});
    }
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

/**
 * The formatters, which are the part of "stop the booking page rebuilding Intl
 * on every keystroke" that a test can hold exactly.
 *
 * The saving is a render cost, and the memo on the picker that stops the grid
 * re-rendering while somebody types their name writes nothing to the DOM either
 * way — that number lives in the pull request with a Profiler. But the thing the
 * saving rests on is not a render count: it is that formatting a thousand slots
 * constructs one formatter, not a thousand. Counting constructions is exact.
 *
 * Each test picks a zone the rest of this file never touches, because the cache
 * is module-level and a warm zone would make the first count zero.
 */
describe("formatter reuse", () => {
  function counting<T>(work: () => T): { result: T; built: number } {
    const Real = Intl.DateTimeFormat;
    let built = 0;
    const Counting = function (...args: unknown[]) {
      built++;
      return new (Real as unknown as new (...a: unknown[]) => Intl.DateTimeFormat)(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Counting.supportedLocalesOf = Real.supportedLocalesOf;
    Intl.DateTimeFormat = Counting;
    try {
      return { result: work(), built };
    } finally {
      Intl.DateTimeFormat = Real;
    }
  }

  function slotsOver(days: number, perDay: number, zoneOffsetHour = 13) {
    const out: Array<{ start: string; end: string }> = [];
    const base = Date.UTC(2026, 9, 5, zoneOffsetHour, 0);
    for (let d = 0; d < days; d++) {
      for (let i = 0; i < perDay; i++) {
        const start = base + d * 86_400_000 + i * 30 * 60_000;
        out.push({ start: new Date(start).toISOString(), end: new Date(start + 1_800_000).toISOString() });
      }
    }
    return out;
  }

  // The whole point. Grouping a three-week window used to build a formatter per
  // slot: 336 of them to paint the picker once.
  it("builds one formatter for a whole window of slots, not one per slot", () => {
    const slots = slotsOver(21, 16);
    expect(slots).toHaveLength(336);

    const { result, built } = counting(() => groupSlotsByDate(slots, "America/Argentina/Ushuaia"));
    expect(result.length).toBeGreaterThan(1);
    expect(built).toBe(1);
  });

  it("builds nothing at all once a zone has been seen", () => {
    const slots = slotsOver(10, 12);
    const zone = "Pacific/Chatham";
    groupSlotsByDate(slots, zone);
    formatSlotTime(slots[0].start, zone);
    formatSlotDate(slots[0].start, zone);
    formatSlotFull(slots[0].start, zone);
    formatSlotWeekday(slots[0].start, zone);
    formatSlotDayMonth(slots[0].start, zone);

    const { built } = counting(() => {
      groupSlotsByDate(slots, zone);
      for (const slot of slots) {
        formatSlotTime(slot.start, zone);
        formatSlotWeekday(slot.start, zone);
        formatSlotDayMonth(slot.start, zone);
      }
      formatSlotDate(slots[0].start, zone);
      formatSlotFull(slots[0].start, zone);
    });
    expect(built).toBe(0);
  });

  /**
   * An oracle that shares none of the module's machinery: the formatter is built
   * here, in the test, and the cached answers are compared against it. A cache
   * that returned a stale or wrong-zone formatter would pass a count assertion
   * and fail this one.
   */
  it("answers exactly as a formatter built from scratch does", () => {
    const zone = "Asia/Kathmandu";
    const instants = [
      "2026-01-01T00:00:00.000Z",
      "2026-03-29T01:30:00.000Z", // European DST boundary
      "2026-07-04T18:45:00.000Z",
      "2026-11-01T05:59:00.000Z", // US DST boundary
      "2026-12-31T23:59:00.000Z",
    ];
    for (const iso of instants) {
      const at = new Date(iso);
      expect(dateInTimezone(at, zone)).toBe(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(at),
      );
      expect(formatSlotTime(iso, zone)).toBe(
        new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at),
      );
      expect(formatSlotWeekday(iso, zone)).toBe(
        new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(at),
      );
      expect(formatSlotDayMonth(iso, zone)).toBe(
        new Intl.DateTimeFormat("en-US", { timeZone: zone, day: "numeric", month: "short" }).format(at),
      );
    }
  });

  // A cache keyed on the shape alone would pass every count assertion above and
  // show an invitee in Singapore a London host's times.
  it("keeps the zones apart", () => {
    const iso = "2026-10-05T22:30:00.000Z";
    expect(formatSlotTime(iso, "Europe/London")).toBe("11:30 PM");
    expect(formatSlotTime(iso, "Asia/Singapore")).toBe("6:30 AM");
    // And back again: the second zone must not have displaced the first.
    expect(formatSlotTime(iso, "Europe/London")).toBe("11:30 PM");
    expect(dateInTimezone(new Date(iso), "Europe/London")).toBe("2026-10-05");
    expect(dateInTimezone(new Date(iso), "Asia/Singapore")).toBe("2026-10-06");
  });

  /**
   * A zone this runtime does not know throws in the constructor, so nothing is
   * cached for it and every caller keeps its own plain-ISO fallback. Two things
   * follow, and the second is why the map cannot be grown by a browser sending
   * junk: the fallback answer is returned every time, and a real zone asked
   * immediately afterwards is unaffected.
   */
  it("falls back for a zone it does not know, without disturbing a real one", () => {
    const iso = "2026-10-05T22:30:00.000Z";
    for (let i = 0; i < 5; i++) {
      expect(dateInTimezone(new Date(iso), "Mars/Olympus_Mons")).toBe("2026-10-05");
      expect(formatSlotTime(iso, "Not/AZone")).toBe("22:30");
    }
    expect(formatSlotTime(iso, "Asia/Singapore")).toBe("6:30 AM");
  });

  // The picker's day rail built these two inline, in the render body, once per
  // day shown. They moved into the module so they are cached with the rest — and
  // so an unknown zone falls back instead of throwing mid-render.
  it("labels a day the way the rail used to", () => {
    const iso = "2026-10-05T14:00:00.000Z"; // a Monday
    expect(formatSlotWeekday(iso, "UTC")).toBe("Mon");
    expect(formatSlotDayMonth(iso, "UTC")).toBe("Oct 5");
    expect(formatSlotWeekday(iso, "Mars/Olympus_Mons")).toBe("Mon");
  });
});

describe("booking prefill", () => {
  it("keeps a usable name and email from a link", () => {
    expect(parseBookingPrefill({ name: "  Ada Lovelace ", email: " ada@example.com " })).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(parseBookingPrefill({ name: ["Ada", "Grace"] })).toEqual({ name: "Ada" });
  });

  it("drops what the form would refuse anyway", () => {
    expect(parseBookingPrefill({ email: "not-an-email" })).toEqual({});
    expect(parseBookingPrefill({ name: "Ada\r\nBcc: x@y.com" })).toEqual({});
    expect(parseBookingPrefill({ name: "a".repeat(201), email: `${"a".repeat(250)}@x.com` })).toEqual({});
    expect(parseBookingPrefill({ name: 42 as unknown as string })).toEqual({});
    expect(parseBookingPrefill(undefined)).toEqual({});
  });

  it("carries it on a booking link, and nothing when there is none", () => {
    expect(bookingPrefillQuery({})).toBe("");
    expect(bookingPrefillQuery(null)).toBe("");
    expect(buildBookingPageUrl("https://fundexecs.com", "ada", undefined, { name: "Grace H", email: "g+1@x.com" })).toBe(
      "https://fundexecs.com/book/ada?name=Grace+H&email=g%2B1%40x.com",
    );
    expect(buildBookingPageUrl("https://fundexecs.com", "ada", "intro", { email: "g@x.com" })).toBe(
      "https://fundexecs.com/book/ada/intro?email=g%40x.com",
    );
  });

  it("round-trips through the query it builds", () => {
    const prefill = { name: "Zoë O'Brien & co", email: "zoe+tag@example.co.uk" };
    const query = new URLSearchParams(bookingPrefillQuery(prefill).slice(1));
    expect(parseBookingPrefill(Object.fromEntries(query))).toEqual(prefill);
  });
});
