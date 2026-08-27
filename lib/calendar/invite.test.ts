import { buildInviteIcs, inviteSequence, inviteUid } from "./invite";
import { unfoldLines } from "./ics";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function base() {
  return {
    uid: "booking-abc@app.test",
    method: "REQUEST" as const,
    title: "Intro call",
    startIso: "2026-09-10T15:00:00.000Z",
    endIso: "2026-09-10T15:30:00.000Z",
    organizer: { name: "Rae Bey", email: "rae@fund.test" },
    attendees: [{ name: "Ada Lovelace", email: "ada@example.com" }],
    now: NOW,
  };
}

function props(ics: string): string[] {
  return unfoldLines(ics);
}

function prop(ics: string, name: string): string | undefined {
  return props(ics).find((l) => l.startsWith(name));
}

describe("inviteUid", () => {
  it("is stable and namespaced to the deployment", () => {
    expect(inviteUid("abc", "https://app.test")).toBe("booking-abc@app.test");
  });

  it("survives an origin that is not a URL", () => {
    expect(inviteUid("abc", "")).toBe("booking-abc@fundexecs");
    expect(inviteUid("abc", "not a url")).toBe("booking-abc@fundexecs");
  });

  it("keeps the port, which distinguishes local deployments", () => {
    expect(inviteUid("abc", "http://localhost:3000")).toBe("booking-abc@localhost:3000");
  });
});

describe("inviteSequence", () => {
  it("starts at zero for a booking that has never changed", () => {
    expect(inviteSequence("2026-09-01T12:00:00Z", "2026-09-01T12:00:00Z")).toBe(0);
    expect(inviteSequence("2026-09-01T12:00:00Z", null)).toBe(0);
  });

  it("rises with each revision", () => {
    const created = "2026-09-01T12:00:00Z";
    const first = inviteSequence(created, "2026-09-01T12:05:00Z");
    const second = inviteSequence(created, "2026-09-01T13:00:00Z");
    expect(first).toBe(300);
    expect(second).toBeGreaterThan(first);
  });

  it("never goes backwards, which would make clients ignore the update", () => {
    // A clock skew that puts updated_at before created_at must not produce a
    // negative sequence — clients reject an update that does not increase.
    expect(inviteSequence("2026-09-01T12:00:00Z", "2026-08-01T12:00:00Z")).toBe(0);
  });

  it("copes with unparseable timestamps", () => {
    expect(inviteSequence("nonsense", "also nonsense")).toBe(0);
  });
});

describe("buildInviteIcs — a request", () => {
  it("is an iTIP request, not a published feed", () => {
    const ics = buildInviteIcs(base());
    expect(prop(ics, "METHOD:")).toBe("METHOD:REQUEST");
    expect(prop(ics, "STATUS:")).toBe("STATUS:CONFIRMED");
  });

  it("carries the organizer and the attendee", () => {
    const ics = buildInviteIcs(base());
    expect(prop(ics, "ORGANIZER")).toContain('CN="Rae Bey"');
    expect(prop(ics, "ORGANIZER")).toContain("MAILTO:rae@fund.test");
    expect(prop(ics, "ATTENDEE")).toContain('CN="Ada Lovelace"');
    expect(prop(ics, "ATTENDEE")).toContain("MAILTO:ada@example.com");
  });

  it("asks for an RSVP, which is what shows Accept/Decline", () => {
    expect(prop(buildInviteIcs(base()), "ATTENDEE")).toContain("RSVP=TRUE");
  });

  it("uses CRLF, which the spec requires and clients enforce", () => {
    expect(buildInviteIcs(base())).toContain("\r\n");
    expect(buildInviteIcs(base()).endsWith("\r\n")).toBe(true);
  });

  it("writes times in UTC", () => {
    const ics = buildInviteIcs(base());
    expect(prop(ics, "DTSTART:")).toBe("DTSTART:20260910T150000Z");
    expect(prop(ics, "DTEND:")).toBe("DTEND:20260910T153000Z");
    expect(prop(ics, "DTSTAMP:")).toBe("DTSTAMP:20260901T120000Z");
  });

  it("includes the optional fields only when there is something to say", () => {
    const bare = buildInviteIcs(base());
    expect(prop(bare, "DESCRIPTION")).toBeUndefined();
    expect(prop(bare, "LOCATION")).toBeUndefined();

    const full = buildInviteIcs({ ...base(), description: "Agenda", location: "https://app.test/x" });
    expect(prop(full, "DESCRIPTION")).toContain("Agenda");
    expect(prop(full, "LOCATION")).toContain("app.test");
  });

  it("skips an attendee with no address rather than emitting a broken line", () => {
    const ics = buildInviteIcs({ ...base(), attendees: [{ email: "  " }, { email: "ada@example.com" }] });
    expect(props(ics).filter((l) => l.startsWith("ATTENDEE"))).toHaveLength(1);
  });
});

describe("buildInviteIcs — a cancellation", () => {
  it("cancels rather than creating a second entry", () => {
    // Same UID, higher sequence, STATUS:CANCELLED — that combination is what
    // removes the meeting instead of leaving a stale one behind.
    const ics = buildInviteIcs({ ...base(), method: "CANCEL", sequence: 42 });
    expect(prop(ics, "METHOD:")).toBe("METHOD:CANCEL");
    expect(prop(ics, "STATUS:")).toBe("STATUS:CANCELLED");
    expect(prop(ics, "SEQUENCE:")).toBe("SEQUENCE:42");
    expect(prop(ics, "UID:")).toBe("UID:booking-abc@app.test");
  });

  it("does not ask for an RSVP to a cancelled meeting", () => {
    const ics = buildInviteIcs({ ...base(), method: "CANCEL" });
    expect(prop(ics, "ATTENDEE")).not.toContain("RSVP=TRUE");
  });
});

describe("buildInviteIcs — hostile input", () => {
  it("escapes a title that would otherwise inject a property", () => {
    // Booking details come from an anonymous visitor on a public page.
    const ics = buildInviteIcs({ ...base(), title: "Hi\r\nSUMMARY:Injected\r\nX-EVIL:1" });
    const summaries = props(ics).filter((l) => l.startsWith("SUMMARY"));
    expect(summaries).toHaveLength(1);
    expect(props(ics).some((l) => l.startsWith("X-EVIL"))).toBe(false);
  });

  it("strips newlines out of an address", () => {
    const ics = buildInviteIcs({ ...base(), attendees: [{ email: "a@b.test\r\nX-EVIL:1" }] });
    expect(props(ics).some((l) => l.startsWith("X-EVIL"))).toBe(false);
  });

  it("strips quotes from a name so CN cannot be broken out of", () => {
    const ics = buildInviteIcs({ ...base(), attendees: [{ name: 'A";X-EVIL=1;CN="B', email: "a@b.test" }] });
    const attendee = prop(ics, "ATTENDEE")!;

    // Exactly two quotes: the CN delimiters. The injected ones are gone, so the
    // semicolons stay inside the quoted value, where RFC 5545 reads them as
    // literal text rather than as parameter separators.
    expect((attendee.match(/"/g) ?? [])).toHaveLength(2);
    expect(attendee).toContain('CN="A;X-EVIL=1;CN=B"');
    expect(attendee).toContain("MAILTO:a@b.test");
    expect(props(ics).some((l) => l.startsWith("X-EVIL"))).toBe(false);
  });

  it("gives a zero-length meeting a real duration", () => {
    const ics = buildInviteIcs({ ...base(), endIso: base().startIso });
    expect(prop(ics, "DTEND:")).toBe("DTEND:20260910T153000Z");
  });

  it("refuses an unparseable time rather than emitting a broken invite", () => {
    expect(() => buildInviteIcs({ ...base(), startIso: "nonsense" })).toThrow(/invalid time/);
  });

  it("never emits a negative sequence", () => {
    expect(prop(buildInviteIcs({ ...base(), sequence: -5 }), "SEQUENCE:")).toBe("SEQUENCE:0");
  });
});
