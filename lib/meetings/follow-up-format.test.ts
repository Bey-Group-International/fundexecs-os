import {
  followUpBlocks,
  followUpBodyHtml,
  plainFollowUp,
  toggleList,
  wrapSelection,
} from "@/lib/meetings/follow-up-format";

describe("followUpBlocks", () => {
  it("splits paragraphs, keeps line breaks, and finds lists inside a paragraph", () => {
    const blocks = followUpBlocks("Hi Jane,\n\nAction items:\n1. Send deck\n2. Book call\n\nBest,\nAlex");
    expect(blocks).toEqual([
      { kind: "p", html: "Hi Jane," },
      { kind: "p", html: "Action items:" },
      { kind: "ol", items: ["Send deck", "Book call"] },
      { kind: "p", html: "Best,<br />Alex" },
    ]);
  });

  it("reads dashes and bullets as a bulleted list", () => {
    expect(followUpBlocks("- one\n• two")).toEqual([{ kind: "ul", items: ["one", "two"] }]);
  });

  // The safety argument: nothing typed becomes markup of its own.
  it("escapes before it formats", () => {
    const [block] = followUpBlocks('<img src=x onerror="alert(1)"> **bold**');
    expect(block).toEqual({
      kind: "p",
      html: "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <strong>bold</strong>",
    });
  });

  it("leaves underscores inside words and addresses alone", () => {
    const [block] = followUpBlocks("Write to first_last@fund.test about _this_");
    expect(block).toEqual({ kind: "p", html: "Write to first_last@fund.test about <em>this</em>" });
  });
});

describe("followUpBodyHtml", () => {
  it("applies the caller's inline styles", () => {
    const html = followUpBodyHtml("Hi\n\n- a", { p: "P", list: "L", li: "I" });
    expect(html).toContain('<p style="P">Hi</p>');
    expect(html).toContain('<ul style="L"><li style="I">a</li></ul>');
  });
});

describe("plainFollowUp", () => {
  it("drops the emphasis marks and keeps the words and lists", () => {
    expect(plainFollowUp("**Due** _Friday_\n- item")).toBe("Due Friday\n- item");
  });
});

describe("toolbar edits", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(wrapSelection("send deck", 0, 4, "**")).toEqual({ text: "**send** deck", start: 2, end: 6 });
  });

  it("turns the selected lines into a numbered list, and back again", () => {
    const on = toggleList("a\nb", 0, 3, "ol");
    expect(on.text).toBe("1. a\n2. b");
    expect(toggleList(on.text, 0, on.text.length, "ol").text).toBe("a\nb");
  });

  it("turns the caret's line into a bullet", () => {
    expect(toggleList("intro\nitem\nend", 7, 7, "ul").text).toBe("intro\n- item\nend");
  });
});
