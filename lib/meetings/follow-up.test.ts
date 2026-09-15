import {
  MAX_FOLLOW_UP_CHARS,
  followUpBody,
  followUpHtml,
  followUpRecipients,
  followUpSubject,
} from "@/lib/meetings/follow-up";

describe("followUpRecipients", () => {
  it("takes everyone on the meeting who has an address", () => {
    expect(
      followUpRecipients(
        [
          { name: "Sarah Chen", email: "sarah@fund.test" },
          { name: "Mike", email: "mike@fund.test" },
        ],
        "host@fund.test",
      ),
    ).toEqual([
      { name: "Sarah Chen", email: "sarah@fund.test" },
      { name: "Mike", email: "mike@fund.test" },
    ]);
  });

  it("leaves the sender out of their own follow-up", () => {
    expect(followUpRecipients([{ name: "Host", email: "Host@Fund.test" }], "host@fund.test")).toEqual([]);
  });

  it("drops an attendee nobody could email", () => {
    // Entered by name alone. Counting them as sent to would be a lie.
    expect(followUpRecipients([{ name: "Priya" }], "host@fund.test")).toEqual([]);
  });

  it("sends once to somebody listed twice", () => {
    expect(
      followUpRecipients(
        [{ name: "Sarah", email: "sarah@fund.test" }, { name: "S. Chen", email: "SARAH@fund.test" }],
        null,
      ),
    ).toHaveLength(1);
  });

  it("falls back to the address when an attendee has no name", () => {
    expect(followUpRecipients([{ name: "", email: "sarah@fund.test" }], null)[0].name).toBe("sarah@fund.test");
  });

  it("survives a malformed attendee list", () => {
    expect(followUpRecipients([null as never, undefined as never], null)).toEqual([]);
    expect(followUpRecipients(null, null)).toEqual([]);
  });
});

describe("followUpSubject", () => {
  it("uses the meeting's own title so the thread is findable", () => {
    expect(followUpSubject("Series B sync")).toBe("Follow-up: Series B sync");
  });

  it("still says something for an untitled meeting", () => {
    expect(followUpSubject("  ")).toBe("Meeting follow-up");
    expect(followUpSubject(null)).toBe("Meeting follow-up");
  });
});

describe("followUpBody", () => {
  it("trims, and treats nothing as nothing", () => {
    expect(followUpBody("  Hello  ")).toBe("Hello");
    expect(followUpBody("   ")).toBe("");
    expect(followUpBody(null)).toBe("");
  });

  it("caps a body that is no longer an email", () => {
    expect(followUpBody("x".repeat(MAX_FOLLOW_UP_CHARS + 500)).length).toBe(MAX_FOLLOW_UP_CHARS);
  });
});

describe("followUpHtml", () => {
  it("keeps the line breaks the draft's lists are made of", () => {
    expect(followUpHtml("1. Wire the funds\n2. Send the deck")).toContain(
      "1. Wire the funds<br />2. Send the deck",
    );
  });

  it("starts a new paragraph on a blank line", () => {
    const html = followUpHtml("Hi all,\n\nGood meeting.");
    expect(html).toContain("<p style=\"font-size:14px;line-height:1.6;margin:0 0 16px\">Hi all,</p>");
    expect(html).toContain(">Good meeting.</p>");
  });

  // The draft is model output the host may have edited by hand, and it is
  // about to be rendered in other people's mail clients.
  it("escapes what it is given", () => {
    const html = followUpHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
