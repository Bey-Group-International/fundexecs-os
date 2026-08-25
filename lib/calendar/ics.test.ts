// The ICS core is the foundation of both directions of calendar sync, and its
// failure mode is silent: a missed event means a slot stays bookable when the
// host is busy. These tests lean on the cases real feeds actually contain.
import {
  buildIcs,
  busyEventsOnly,
  escapeText,
  expandRecurrence,
  foldLine,
  parseIcs,
  parseIcsDate,
  parseIcsDuration,
  parsePropertyLine,
  parseRRule,
  toIcsUtc,
  unescapeText,
  unfoldLines,
  zonedWallTimeToUtc,
} from "./ics";

const WINDOW = {
  windowStart: new Date("2026-09-01T00:00:00Z"),
  windowEnd: new Date("2026-10-01T00:00:00Z"),
};

/** Wrap VEVENT bodies in a minimal calendar. */
function cal(...events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
}

function vevent(...lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

describe("unfoldLines", () => {
  it("rejoins folded continuation lines", () => {
    expect(unfoldLines("SUMMARY:A very\r\n  long title")).toEqual(["SUMMARY:A very long title"]);
  });

  it("accepts bare LF, which real feeds emit despite the spec", () => {
    expect(unfoldLines("A:1\nB:2")).toEqual(["A:1", "B:2"]);
  });

  it("treats a tab as a continuation too", () => {
    expect(unfoldLines("A:one\n\ttwo")).toEqual(["A:onetwo"]);
  });
});

describe("parsePropertyLine", () => {
  it("splits name, params and value", () => {
    expect(parsePropertyLine("DTSTART;TZID=America/New_York:20260901T090000")).toEqual({
      name: "DTSTART",
      params: { TZID: "America/New_York" },
      value: "20260901T090000",
    });
  });

  it("does not split on a colon inside a quoted parameter", () => {
    const p = parsePropertyLine('ATTENDEE;ALTREP="http://x.test/a":mailto:a@b.test');
    expect(p?.name).toBe("ATTENDEE");
    expect(p?.params.ALTREP).toBe("http://x.test/a");
    expect(p?.value).toBe("mailto:a@b.test");
  });

  it("returns null for a line with no colon", () => {
    expect(parsePropertyLine("GARBAGE")).toBeNull();
  });
});

describe("text escaping", () => {
  it("round-trips the characters RFC 5545 reserves", () => {
    const original = "Meeting: A, B; and\na newline \\ backslash";
    expect(unescapeText(escapeText(original))).toBe(original);
  });

  it("escapes backslash first so it does not double-escape", () => {
    expect(escapeText("a\\b")).toBe("a\\\\b");
  });
});

describe("parseIcsDate", () => {
  it("reads a UTC date-time", () => {
    expect(parseIcsDate("20260901T140000Z")?.date.toISOString()).toBe("2026-09-01T14:00:00.000Z");
  });

  it("reads a date-only value as a whole day", () => {
    const d = parseIcsDate("20260901", { VALUE: "DATE" });
    expect(d?.dateOnly).toBe(true);
    expect(d?.date.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("converts a TZID wall time to the right instant", () => {
    // 09:00 New York in September is EDT (UTC-4) → 13:00Z.
    const d = parseIcsDate("20260901T090000", { TZID: "America/New_York" });
    expect(d?.date.toISOString()).toBe("2026-09-01T13:00:00.000Z");
  });

  it("handles a zone east of UTC", () => {
    // 09:00 Tokyo is UTC+9 → 00:00Z the same day.
    const d = parseIcsDate("20260901T090000", { TZID: "Asia/Tokyo" });
    expect(d?.date.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("falls back rather than dropping an event with an unknown TZID", () => {
    const d = parseIcsDate("20260901T090000", { TZID: "Mars/Olympus" });
    expect(d?.date.toISOString()).toBe("2026-09-01T09:00:00.000Z");
  });

  it("returns null for a malformed value", () => {
    expect(parseIcsDate("not-a-date")).toBeNull();
  });
});

describe("zonedWallTimeToUtc", () => {
  it("resolves correctly across a DST boundary", () => {
    // 2026-11-01 is the US fall-back. 09:00 that day is EST (UTC-5) → 14:00Z.
    const d = zonedWallTimeToUtc(
      { year: 2026, month: 11, day: 1, hour: 9, minute: 0, second: 0 },
      "America/New_York",
    );
    expect(d?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("returns null for an unrecognized zone", () => {
    expect(zonedWallTimeToUtc({ year: 2026, month: 9, day: 1, hour: 9, minute: 0, second: 0 }, "Nope/Nope")).toBeNull();
  });
});

describe("parseIcsDuration", () => {
  it("reads hours and minutes", () => {
    expect(parseIcsDuration("PT1H30M")).toBe(90 * 60_000);
  });

  it("reads days and weeks", () => {
    expect(parseIcsDuration("P2D")).toBe(2 * 86_400_000);
    expect(parseIcsDuration("P1W")).toBe(7 * 86_400_000);
  });

  it("rejects nonsense", () => {
    expect(parseIcsDuration("banana")).toBeNull();
  });
});

describe("parseRRule", () => {
  it("reads frequency, interval and count", () => {
    expect(parseRRule("FREQ=WEEKLY;INTERVAL=2;COUNT=5")).toMatchObject({
      freq: "WEEKLY",
      interval: 2,
      count: 5,
    });
  });

  it("strips positional prefixes from BYDAY", () => {
    // "2MO" (second Monday) is not fully supported; the weekday still counts.
    expect(parseRRule("FREQ=MONTHLY;BYDAY=2MO")?.byDay).toEqual(["MO"]);
  });

  it("rejects an unsupported frequency", () => {
    expect(parseRRule("FREQ=SECONDLY")).toBeNull();
  });
});

describe("expandRecurrence", () => {
  const rule = (s: string) => parseRRule(s)!;

  it("expands a daily rule inside the window", () => {
    const out = expandRecurrence(
      new Date("2026-09-01T09:00:00Z"),
      rule("FREQ=DAILY;COUNT=3"),
      WINDOW.windowStart,
      WINDOW.windowEnd,
    );
    expect(out.map((d) => d.toISOString())).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-02T09:00:00.000Z",
      "2026-09-03T09:00:00.000Z",
    ]);
  });

  it("honours UNTIL", () => {
    const out = expandRecurrence(
      new Date("2026-09-01T09:00:00Z"),
      rule("FREQ=DAILY;UNTIL=20260903T090000Z"),
      WINDOW.windowStart,
      WINDOW.windowEnd,
    );
    expect(out).toHaveLength(3);
  });

  it("expands a weekly rule on several weekdays", () => {
    // 2026-09-01 is a Tuesday. Tue/Thu weekly.
    const out = expandRecurrence(
      new Date("2026-09-01T09:00:00Z"),
      rule("FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4"),
      WINDOW.windowStart,
      WINDOW.windowEnd,
    );
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-03",
      "2026-09-08",
      "2026-09-10",
    ]);
  });

  it("clamps a month-end recurrence instead of drifting", () => {
    // Jan 31 + 1 month must not roll into March.
    const out = expandRecurrence(
      new Date("2026-01-31T09:00:00Z"),
      rule("FREQ=MONTHLY;COUNT=3"),
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-06-01T00:00:00Z"),
    );
    expect(out.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("stays bounded for an unbounded rule", () => {
    // No COUNT and no UNTIL — the window is the only limit.
    const out = expandRecurrence(
      new Date("2026-09-01T09:00:00Z"),
      rule("FREQ=DAILY"),
      WINDOW.windowStart,
      WINDOW.windowEnd,
    );
    expect(out.length).toBe(30);
  });
});

describe("parseIcs", () => {
  it("reads a simple timed event", () => {
    const out = parseIcs(
      cal(vevent("UID:a@test", "SUMMARY:Board call", "DTSTART:20260902T140000Z", "DTEND:20260902T150000Z")),
      WINDOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      uid: "a@test",
      summary: "Board call",
      startIso: "2026-09-02T14:00:00.000Z",
      endIso: "2026-09-02T15:00:00.000Z",
      allDay: false,
      transparent: false,
    });
  });

  it("derives the end from DURATION when DTEND is absent", () => {
    const out = parseIcs(
      cal(vevent("UID:b@test", "DTSTART:20260902T140000Z", "DURATION:PT45M")),
      WINDOW,
    );
    expect(out[0].endIso).toBe("2026-09-02T14:45:00.000Z");
  });

  it("gives an all-day event a full day", () => {
    const out = parseIcs(cal(vevent("UID:c@test", "DTSTART;VALUE=DATE:20260902")), WINDOW);
    expect(out[0]).toMatchObject({
      allDay: true,
      startIso: "2026-09-02T00:00:00.000Z",
      endIso: "2026-09-03T00:00:00.000Z",
    });
  });

  it("marks TRANSPARENT and CANCELLED events as not consuming time", () => {
    const out = parseIcs(
      cal(
        vevent("UID:free@test", "DTSTART:20260902T140000Z", "DTEND:20260902T150000Z", "TRANSP:TRANSPARENT"),
        vevent("UID:gone@test", "DTSTART:20260903T140000Z", "DTEND:20260903T150000Z", "STATUS:CANCELLED"),
        vevent("UID:busy@test", "DTSTART:20260904T140000Z", "DTEND:20260904T150000Z"),
      ),
      WINDOW,
    );
    expect(out).toHaveLength(3);
    expect(busyEventsOnly(out).map((e) => e.uid)).toEqual(["busy@test"]);
  });

  it("expands a recurring event into separate instances", () => {
    const out = parseIcs(
      cal(
        vevent(
          "UID:standup@test",
          "SUMMARY:Standup",
          "DTSTART:20260901T090000Z",
          "DTEND:20260901T091500Z",
          "RRULE:FREQ=DAILY;COUNT=3",
        ),
      ),
      WINDOW,
    );
    expect(out).toHaveLength(3);
    expect(out.every((e) => e.summary === "Standup")).toBe(true);
    expect(out[2].startIso).toBe("2026-09-03T09:00:00.000Z");
  });

  it("honours EXDATE within a series", () => {
    const out = parseIcs(
      cal(
        vevent(
          "UID:s@test",
          "DTSTART:20260901T090000Z",
          "DTEND:20260901T091500Z",
          "RRULE:FREQ=DAILY;COUNT=3",
          "EXDATE:20260902T090000Z",
        ),
      ),
      WINDOW,
    );
    expect(out.map((e) => e.startIso)).toEqual(["2026-09-01T09:00:00.000Z", "2026-09-03T09:00:00.000Z"]);
  });

  it("skips a RECURRENCE-ID override rather than double-counting the slot", () => {
    const out = parseIcs(
      cal(
        vevent("UID:s@test", "DTSTART:20260901T090000Z", "DTEND:20260901T093000Z", "RRULE:FREQ=DAILY;COUNT=2"),
        vevent(
          "UID:s@test",
          "RECURRENCE-ID:20260902T090000Z",
          "DTSTART:20260902T100000Z",
          "DTEND:20260902T103000Z",
        ),
      ),
      WINDOW,
    );
    // Two from the series, none from the override.
    expect(out).toHaveLength(2);
  });

  it("includes an event that starts before the window but runs into it", () => {
    const out = parseIcs(
      cal(vevent("UID:long@test", "DTSTART:20260831T230000Z", "DTEND:20260901T010000Z")),
      WINDOW,
    );
    expect(out).toHaveLength(1);
  });

  it("excludes events wholly outside the window", () => {
    const out = parseIcs(
      cal(vevent("UID:past@test", "DTSTART:20260101T090000Z", "DTEND:20260101T100000Z")),
      WINDOW,
    );
    expect(out).toEqual([]);
  });

  it("ignores VALARM contents so an alarm is not read as the event", () => {
    const out = parseIcs(
      cal(
        [
          "BEGIN:VEVENT",
          "UID:alarm@test",
          "SUMMARY:Real title",
          "DTSTART:20260902T140000Z",
          "DTEND:20260902T150000Z",
          "BEGIN:VALARM",
          "TRIGGER:-PT15M",
          "DESCRIPTION:Reminder text",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n"),
      ),
      WINDOW,
    );
    expect(out[0].summary).toBe("Real title");
    expect(out[0].description).toBeNull();
  });

  it("skips one malformed event but keeps the rest of the feed", () => {
    const out = parseIcs(
      cal(
        vevent("UID:bad@test", "DTSTART:garbage", "DTEND:also-garbage"),
        vevent("UID:good@test", "DTSTART:20260902T140000Z", "DTEND:20260902T150000Z"),
      ),
      WINDOW,
    );
    expect(out.map((e) => e.uid)).toEqual(["good@test"]);
  });

  it("returns nothing for input that is not a calendar at all", () => {
    expect(parseIcs("<html>404 Not Found</html>", WINDOW)).toEqual([]);
    expect(parseIcs("", WINDOW)).toEqual([]);
  });

  it("respects maxEvents so a huge feed stays bounded", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      vevent(`UID:e${i}@test`, `DTSTART:202609${String((i % 28) + 1).padStart(2, "0")}T090000Z`, "DURATION:PT1H"),
    );
    expect(parseIcs(cal(...many), { ...WINDOW, maxEvents: 10 })).toHaveLength(10);
  });

  it("unescapes text values", () => {
    const out = parseIcs(
      cal(vevent("UID:esc@test", "SUMMARY:Smith\\, Jones\\; and Co", "DTSTART:20260902T140000Z", "DURATION:PT1H")),
      WINDOW,
    );
    expect(out[0].summary).toBe("Smith, Jones; and Co");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds a long line with a leading space on continuations", () => {
    const folded = foldLine("SUMMARY:" + "x".repeat(200));
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe("SUMMARY:" + "x".repeat(200));
  });

  it("counts octets, not characters, and never splits a character", () => {
    // Multi-byte characters: folding by character count would exceed 75 octets.
    const line = "SUMMARY:" + "é".repeat(60);
    for (const part of foldLine(line).split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(foldLine(line).replace(/\r\n /g, "")).toBe(line);
  });
});

describe("buildIcs", () => {
  const NOW = new Date("2026-08-25T12:00:00Z");
  const base = {
    calendarName: "Nia — FundExecs",
    now: NOW,
  };

  it("produces a calendar a client will accept", () => {
    const ics = buildIcs(
      [
        {
          uid: "m1@fundexecs",
          startIso: "2026-09-02T14:00:00.000Z",
          endIso: "2026-09-02T15:00:00.000Z",
          summary: "Board call",
        },
      ],
      base,
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:m1@fundexecs");
    expect(ics).toContain("DTSTART:20260902T140000Z");
    expect(ics).toContain("DTEND:20260902T150000Z");
    expect(ics).toContain("SUMMARY:Board call");
    expect(ics).toContain("END:VCALENDAR");
    // CRLF endings are required by the spec and enforced by some clients.
    expect(ics.includes("\r\n")).toBe(true);
  });

  it("names the calendar so subscribers show a title, not a URL", () => {
    expect(buildIcs([], base)).toContain("X-WR-CALNAME:Nia — FundExecs");
  });

  it("marks a cancelled event so subscribers remove it", () => {
    const ics = buildIcs(
      [
        {
          uid: "gone@fundexecs",
          startIso: "2026-09-02T14:00:00.000Z",
          endIso: "2026-09-02T15:00:00.000Z",
          summary: "Cancelled call",
          cancelled: true,
          sequence: 2,
        },
      ],
      base,
    );
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
  });

  it("drops an event whose times are unusable rather than emitting a broken one", () => {
    const ics = buildIcs(
      [
        { uid: "bad@x", startIso: "nope", endIso: "also-nope", summary: "Bad" },
        { uid: "inverted@x", startIso: "2026-09-02T15:00:00Z", endIso: "2026-09-02T14:00:00Z", summary: "Inverted" },
        { uid: "ok@x", startIso: "2026-09-02T14:00:00Z", endIso: "2026-09-02T15:00:00Z", summary: "Fine" },
      ],
      base,
    );
    expect(ics).toContain("UID:ok@x");
    expect(ics).not.toContain("UID:bad@x");
    expect(ics).not.toContain("UID:inverted@x");
  });

  it("escapes reserved characters in user-supplied text", () => {
    const ics = buildIcs(
      [
        {
          uid: "esc@x",
          startIso: "2026-09-02T14:00:00Z",
          endIso: "2026-09-02T15:00:00Z",
          summary: "Smith, Jones; Co",
        },
      ],
      base,
    );
    expect(ics).toContain("SUMMARY:Smith\\, Jones\\; Co");
  });
});

describe("round trip", () => {
  it("reads back what it writes", () => {
    const written = buildIcs(
      [
        {
          uid: "rt@fundexecs",
          startIso: "2026-09-02T14:00:00.000Z",
          endIso: "2026-09-02T15:30:00.000Z",
          summary: "Quarterly review, with LPs; and notes",
          location: "Room 4",
        },
      ],
      { calendarName: "Test", now: new Date("2026-08-25T12:00:00Z") },
    );
    const read = parseIcs(written, WINDOW);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({
      uid: "rt@fundexecs",
      summary: "Quarterly review, with LPs; and notes",
      startIso: "2026-09-02T14:00:00.000Z",
      endIso: "2026-09-02T15:30:00.000Z",
      location: "Room 4",
      transparent: false,
    });
  });
});

describe("toIcsUtc", () => {
  it("formats an instant in the compact UTC form", () => {
    expect(toIcsUtc(new Date("2026-09-02T14:05:09Z"))).toBe("20260902T140509Z");
  });
});
