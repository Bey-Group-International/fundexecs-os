import {
  MAX_FOLLOW_UP_CHARS,
  followUpBody,
  followUpHtml,
  followUpSubject,
} from "@/lib/meetings/follow-up";

// Who the follow-up goes to moved to lib/meetings/recipients.ts, where it is
// tested against the attendance table as well as the invite list.

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
