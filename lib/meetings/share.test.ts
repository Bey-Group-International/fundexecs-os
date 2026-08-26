import {
  meetingInviteUrl,
  formatMeetingWhen,
  shareTargetFor,
  canNativeShare,
  displayUrl,
} from "./share";

describe("meetingInviteUrl", () => {
  it("builds an invite link", () => {
    expect(meetingInviteUrl("https://app.test", "abc-def-12")).toBe("https://app.test/meeting-invite/abc-def-12");
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(meetingInviteUrl("https://app.test/", "abc")).toBe("https://app.test/meeting-invite/abc");
    expect(meetingInviteUrl("https://app.test///", "abc")).toBe("https://app.test/meeting-invite/abc");
  });

  it("tolerates a padded origin", () => {
    expect(meetingInviteUrl("  https://app.test  ", "abc")).toBe("https://app.test/meeting-invite/abc");
  });

  it("returns nothing without a room code, rather than a link to the index", () => {
    expect(meetingInviteUrl("https://app.test", "")).toBe("");
    expect(meetingInviteUrl("https://app.test", "   ")).toBe("");
  });

  it("escapes a room code so it cannot alter the path", () => {
    expect(meetingInviteUrl("https://app.test", "a/../admin")).toBe("https://app.test/meeting-invite/a%2F..%2Fadmin");
    expect(meetingInviteUrl("https://app.test", "a b")).toBe("https://app.test/meeting-invite/a%20b");
  });

  it("works against a relative origin", () => {
    expect(meetingInviteUrl("", "abc")).toBe("/meeting-invite/abc");
  });
});

describe("formatMeetingWhen", () => {
  it("says nothing for an unscheduled meeting", () => {
    expect(formatMeetingWhen(null)).toBe("");
    expect(formatMeetingWhen(undefined)).toBe("");
    expect(formatMeetingWhen("")).toBe("");
  });

  it("says nothing for an unparseable timestamp", () => {
    expect(formatMeetingWhen("not a date")).toBe("");
  });

  it("renders in the meeting's timezone", () => {
    const when = formatMeetingWhen("2026-08-26T19:00:00.000Z", "America/New_York");
    expect(when).toContain("Aug 26");
    expect(when).toContain("3:00");
  });

  it("puts the same instant on a different clock in a different zone", () => {
    const ny = formatMeetingWhen("2026-08-26T19:00:00.000Z", "America/New_York");
    const la = formatMeetingWhen("2026-08-26T19:00:00.000Z", "America/Los_Angeles");
    expect(ny).not.toBe(la);
    expect(la).toContain("12:00");
  });

  it("falls back to local formatting rather than throwing on a bad zone", () => {
    // A meeting row can carry a stale or misspelled IANA name; Intl throws on it.
    expect(() => formatMeetingWhen("2026-08-26T19:00:00.000Z", "Mars/Olympus")).not.toThrow();
    expect(formatMeetingWhen("2026-08-26T19:00:00.000Z", "Mars/Olympus")).toContain("Aug");
  });
});

describe("shareTargetFor", () => {
  it("uses the meeting title", () => {
    const t = shareTargetFor({ origin: "https://app.test", roomCode: "abc", title: "Q3 LP update" });
    expect(t.title).toBe("Q3 LP update");
    expect(t.text).toBe("Q3 LP update");
    expect(t.url).toBe("https://app.test/meeting-invite/abc");
  });

  it("falls back to a generic title when the meeting has none", () => {
    expect(shareTargetFor({ origin: "https://app.test", roomCode: "abc" }).title).toBe("FundExecs meeting");
    expect(shareTargetFor({ origin: "https://app.test", roomCode: "abc", title: "   " }).title).toBe("FundExecs meeting");
  });

  it("adds the time when the meeting is scheduled", () => {
    const t = shareTargetFor({
      origin: "https://app.test",
      roomCode: "abc",
      title: "Q3 LP update",
      scheduledAt: "2026-08-26T19:00:00.000Z",
      timeZone: "America/New_York",
    });
    expect(t.text).toContain("Q3 LP update — ");
    expect(t.text).toContain("3:00");
  });

  it("keeps the url out of the text so shared messages don't repeat it", () => {
    const t = shareTargetFor({
      origin: "https://app.test",
      roomCode: "abc",
      title: "Q3 LP update",
      scheduledAt: "2026-08-26T19:00:00.000Z",
    });
    expect(t.text).not.toContain("app.test");
    expect(t.text).not.toContain("meeting-invite");
  });
});

describe("canNativeShare", () => {
  const target = { title: "t", text: "t", url: "https://app.test/meeting-invite/abc" };

  it("is false where the browser has no share sheet", () => {
    expect(canNativeShare({}, target)).toBe(false);
    expect(canNativeShare(null, target)).toBe(false);
    expect(canNativeShare(undefined, target)).toBe(false);
  });

  it("is true when share exists and canShare is absent", () => {
    expect(canNativeShare({ share: async () => {} }, target)).toBe(true);
  });

  it("defers to canShare when the browser offers it", () => {
    expect(canNativeShare({ share: async () => {}, canShare: () => true }, target)).toBe(true);
    expect(canNativeShare({ share: async () => {}, canShare: () => false }, target)).toBe(false);
  });

  it("treats a throwing canShare as a no", () => {
    expect(canNativeShare({ share: async () => {}, canShare: () => { throw new Error("nope"); } }, target)).toBe(false);
  });

  it("is false with no link to share", () => {
    expect(canNativeShare({ share: async () => {} }, { ...target, url: "" })).toBe(false);
  });
});

describe("displayUrl", () => {
  it("drops the scheme, which nobody needs to read", () => {
    expect(displayUrl("https://app.test/meeting-invite/abc")).toBe("app.test/meeting-invite/abc");
    expect(displayUrl("http://app.test/meeting-invite/abc")).toBe("app.test/meeting-invite/abc");
  });

  it("leaves a short link alone", () => {
    expect(displayUrl("https://a.co/x")).toBe("a.co/x");
  });

  it("truncates the middle and keeps the room code visible", () => {
    const url = "https://fundexecs.example.com/meeting-invite/abc-def-1234";
    const shown = displayUrl(url, 30);
    expect(shown.length).toBeLessThanOrEqual(30);
    expect(shown).toContain("…");
    expect(shown.endsWith("1234")).toBe(true);
  });

  it("keeps the host visible so the reader can tell where the link goes", () => {
    const shown = displayUrl("https://fundexecs.example.com/meeting-invite/abc-def-1234", 30);
    expect(shown.startsWith("fundexecs")).toBe(true);
  });
});
