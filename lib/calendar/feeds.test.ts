import {
  FEED_CACHE_TTL_MS,
  FEED_FAILURE_ALERT_THRESHOLD,
  cacheIsStale,
  feedHealth,
  mergeIntervals,
  validateFeedUrl,
} from "./feeds";

describe("validateFeedUrl", () => {
  it("accepts an ordinary https calendar address", () => {
    const r = validateFeedUrl("https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-9f/basic.ics");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toContain("calendar.google.com");
  });

  it("normalizes webcal:// — the scheme calendar apps actually hand out", () => {
    const r = validateFeedUrl("webcal://p24-caldav.icloud.com/published/2/abcdef");
    expect(r).toEqual({ ok: true, url: "https://p24-caldav.icloud.com/published/2/abcdef" });
  });

  it("normalizes an uppercase WEBCAL scheme too", () => {
    const r = validateFeedUrl("WEBCAL://example.com/feed.ics");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.startsWith("https://")).toBe(true);
  });

  it("trims surrounding whitespace from a pasted address", () => {
    const r = validateFeedUrl("   https://outlook.office365.com/owa/calendar/x/calendar.ics  ");
    expect(r.ok).toBe(true);
  });

  it("rejects an empty address with an instruction rather than a parse error", () => {
    const r = validateFeedUrl("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/secret ICS address/i);
  });

  it("rejects something that isn't a URL at all", () => {
    expect(validateFeedUrl("my work calendar").ok).toBe(false);
  });

  // The SSRF boundary. Each of these, if fetched, would have our server read
  // something on our own network and hand the response back to whoever asked.
  describe("refuses to be pointed at our own infrastructure", () => {
    const forbidden = [
      "http://localhost:3000/api/admin",
      "http://LOCALHOST/feed.ics",
      "http://api.localhost/feed.ics",
      "http://0.0.0.0:8080/feed.ics",
      "http://127.0.0.1/feed.ics",
      "http://127.99.1.4/feed.ics",
      "http://10.0.0.7/calendar.ics",
      "http://172.16.4.1/calendar.ics",
      "http://172.31.255.254/calendar.ics",
      "http://192.168.1.1/calendar.ics",
      // The cloud metadata endpoint — the single most valuable SSRF target.
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://0.0.0.0/x.ics",
      "http://[::1]/feed.ics",
      "http://[fd00::1]/feed.ics",
      "http://[fe80::1]/feed.ics",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://db.internal/feed.ics",
      "http://printer.local/feed.ics",
    ];

    it.each(forbidden)("rejects %s", (url) => {
      const r = validateFeedUrl(url);
      expect(r.ok).toBe(false);
    });
  });

  it("still allows public addresses that merely look adjacent to private ranges", () => {
    // 172.15 and 172.32 sit outside 172.16/12; 169.253 outside link-local.
    for (const url of ["http://172.15.0.1/f.ics", "http://172.32.0.1/f.ics", "http://169.253.0.1/f.ics", "http://11.0.0.1/f.ics"]) {
      expect(validateFeedUrl(url).ok).toBe(true);
    }
  });

  it("rejects non-web schemes that could read the local disk or a mailbox", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/f.ics", "gopher://example.com/", "data:text/calendar,BEGIN:VCALENDAR"]) {
      const r = validateFeedUrl(url);
      expect(r.ok).toBe(false);
    }
  });
});

describe("mergeIntervals", () => {
  const iso = (h: number) => new Date(Date.UTC(2026, 8, 1, h)).toISOString();

  it("returns nothing for no input", () => {
    expect(mergeIntervals([])).toEqual([]);
  });

  it("collapses overlapping spans into one", () => {
    expect(mergeIntervals([
      { start: iso(9), end: iso(11) },
      { start: iso(10), end: iso(12) },
    ])).toEqual([{ start: iso(9), end: iso(12) }]);
  });

  it("merges spans that only touch, so 9–10 and 10–11 is one block", () => {
    expect(mergeIntervals([
      { start: iso(9), end: iso(10) },
      { start: iso(10), end: iso(11) },
    ])).toEqual([{ start: iso(9), end: iso(11) }]);
  });

  it("keeps a gap between spans that don't touch", () => {
    const out = mergeIntervals([
      { start: iso(9), end: iso(10) },
      { start: iso(14), end: iso(15) },
    ]);
    expect(out).toHaveLength(2);
  });

  it("sorts unordered input before merging", () => {
    expect(mergeIntervals([
      { start: iso(14), end: iso(15) },
      { start: iso(9), end: iso(10) },
      { start: iso(9), end: iso(16) },
    ])).toEqual([{ start: iso(9), end: iso(16) }]);
  });

  it("swallows a span wholly contained in another", () => {
    expect(mergeIntervals([
      { start: iso(8), end: iso(18) },
      { start: iso(10), end: iso(11) },
    ])).toEqual([{ start: iso(8), end: iso(18) }]);
  });

  it("drops garbage rather than emitting an Invalid Date interval", () => {
    expect(mergeIntervals([
      { start: "not a date", end: iso(10) },
      { start: iso(9), end: "" },
      { start: iso(9), end: iso(10) },
    ])).toEqual([{ start: iso(9), end: iso(10) }]);
  });

  it("drops zero-length and inverted intervals — neither blocks any time", () => {
    expect(mergeIntervals([
      { start: iso(9), end: iso(9) },
      { start: iso(12), end: iso(11) },
    ])).toEqual([]);
  });
});

describe("cacheIsStale", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("treats a never-cached feed as stale", () => {
    expect(cacheIsStale(null, now)).toBe(true);
  });

  it("treats an unparseable timestamp as stale rather than fresh", () => {
    expect(cacheIsStale("whenever", now)).toBe(true);
  });

  it("is fresh just inside the TTL", () => {
    const at = new Date(now.getTime() - FEED_CACHE_TTL_MS + 1000).toISOString();
    expect(cacheIsStale(at, now)).toBe(false);
  });

  it("is stale exactly at the TTL", () => {
    const at = new Date(now.getTime() - FEED_CACHE_TTL_MS).toISOString();
    expect(cacheIsStale(at, now)).toBe(true);
  });
});

describe("feedHealth", () => {
  const recent = () => new Date(Date.now() - 60_000).toISOString();

  it("is quiet when a feed synced recently", () => {
    expect(feedHealth({ lastSuccessAt: recent(), lastError: null, consecutiveFailures: 0 })).toEqual({
      state: "ok",
      message: null,
    });
  });

  it("says a brand-new feed is waiting rather than calling it broken", () => {
    const h = feedHealth({ lastSuccessAt: null, lastError: null, consecutiveFailures: 0 });
    expect(h.state).toBe("never_fetched");
  });

  it("flags a feed that hasn't synced in over six hours", () => {
    const h = feedHealth({
      lastSuccessAt: new Date(Date.now() - 7 * 3600_000).toISOString(),
      lastError: null,
      consecutiveFailures: 0,
    });
    expect(h.state).toBe("stale");
  });

  // The dangerous case: a failing feed imports no busy time, which looks
  // exactly like a free calendar. It has to be loud.
  it("calls a feed failing once it has missed the threshold, and surfaces why", () => {
    const h = feedHealth({
      lastSuccessAt: recent(),
      lastError: "The calendar service returned 404.",
      consecutiveFailures: FEED_FAILURE_ALERT_THRESHOLD,
    });
    expect(h.state).toBe("failing");
    expect(h.message).toContain("404");
  });

  it("still reports failing when there is no error text to show", () => {
    const h = feedHealth({
      lastSuccessAt: recent(),
      lastError: null,
      consecutiveFailures: FEED_FAILURE_ALERT_THRESHOLD + 4,
    });
    expect(h.state).toBe("failing");
    expect(h.message).toBeTruthy();
  });

  it("tolerates one or two blips without alarming the owner", () => {
    const h = feedHealth({ lastSuccessAt: recent(), lastError: "timeout", consecutiveFailures: FEED_FAILURE_ALERT_THRESHOLD - 1 });
    expect(h.state).toBe("ok");
  });
});
