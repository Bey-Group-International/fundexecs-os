import { guestEmails, buildMeetingInviteHtml } from "./invite";

describe("guestEmails", () => {
  it("collects unique, lowercased, validated emails", () => {
    expect(
      guestEmails([
        { name: "Jane", email: "Jane@Fund.com", type: "external" },
        { name: "Jane dup", email: "jane@fund.com", type: "external" },
        { name: "No Email", type: "external" },
        { name: "Bob", email: "bob@fund.com", type: "internal" },
      ]),
    ).toEqual(["jane@fund.com", "bob@fund.com"]);
  });

  it("returns empty for null/empty", () => {
    expect(guestEmails(null)).toEqual([]);
    expect(guestEmails([])).toEqual([]);
    expect(guestEmails([{ name: "No email" }])).toEqual([]);
  });
});

describe("buildMeetingInviteHtml", () => {
  it("embeds an escaped title/sender and a safe join link", () => {
    const html = buildMeetingInviteHtml({
      inviteUrl: "https://app.test/meeting-invite/abc-def-12",
      title: "Q3 <LP> Review",
      senderName: "a@b.com",
    });
    expect(html).toContain("https://app.test/meeting-invite/abc-def-12");
    expect(html).toContain("Q3 &lt;LP&gt; Review");
    expect(html).not.toContain("<LP>");
  });

  it("neutralizes a non-http invite URL", () => {
    const html = buildMeetingInviteHtml({ inviteUrl: "javascript:alert(1)", title: "x", senderName: "y" });
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:alert(1)");
  });
});
