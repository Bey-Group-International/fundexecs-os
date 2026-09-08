import {
  EXPORT_CONTENT_TYPES,
  exportExtension,
  isExportFormat,
  isBinaryFormat,
  renderArtifact,
  renderMarkdownToHtml,
  renderMarkdownToRtf,
} from "./export";

// Count unescaped RTF braces so we can assert the document is balanced. A brace
// preceded by a backslash is an escaped literal, not a group delimiter.
function braceBalance(rtf: string): number {
  let depth = 0;
  for (let i = 0; i < rtf.length; i++) {
    const ch = rtf[i];
    if (ch === "\\") {
      i += 1; // skip the escaped/control char
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth;
}

describe("format helpers", () => {
  it("isExportFormat guards known formats", () => {
    expect(isExportFormat("rtf")).toBe(true);
    expect(isExportFormat("html")).toBe(true);
    expect(isExportFormat("md")).toBe(true);
    expect(isExportFormat("docx")).toBe(true);
    expect(isExportFormat("pdf")).toBe(true);
    expect(isExportFormat("exe")).toBe(false);
    expect(isExportFormat("")).toBe(false);
  });

  it("isBinaryFormat distinguishes the byte-buffer formats", () => {
    expect(isBinaryFormat("docx")).toBe(true);
    expect(isBinaryFormat("pdf")).toBe(true);
    expect(isBinaryFormat("rtf")).toBe(false);
    expect(isBinaryFormat("html")).toBe(false);
    expect(isBinaryFormat("md")).toBe(false);
  });

  it("exportExtension maps each format", () => {
    expect(exportExtension("rtf")).toBe("rtf");
    expect(exportExtension("html")).toBe("html");
    expect(exportExtension("md")).toBe("md");
    expect(exportExtension("docx")).toBe("docx");
    expect(exportExtension("pdf")).toBe("pdf");
  });

  it("EXPORT_CONTENT_TYPES are correct", () => {
    expect(EXPORT_CONTENT_TYPES.rtf).toBe("application/rtf");
    expect(EXPORT_CONTENT_TYPES.html).toBe("text/html; charset=utf-8");
    expect(EXPORT_CONTENT_TYPES.md).toBe("text/markdown; charset=utf-8");
    expect(EXPORT_CONTENT_TYPES.docx).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(EXPORT_CONTENT_TYPES.pdf).toBe("application/pdf");
  });
});

describe("renderMarkdownToRtf", () => {
  it("produces a well-formed RTF document", () => {
    const rtf = renderMarkdownToRtf("# Title\n\nHello **world**.");
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(rtf.endsWith("}")).toBe(true);
    expect(braceBalance(rtf)).toBe(0);
  });

  it("renders a heading with a larger bold size", () => {
    const rtf = renderMarkdownToRtf("## Section");
    expect(rtf).toContain("\\b\\fs30 Section");
  });

  it("renders bold as a \\b group", () => {
    const rtf = renderMarkdownToRtf("this is **bold** text");
    expect(rtf).toContain("{\\b bold}");
  });

  it("renders bullets", () => {
    const rtf = renderMarkdownToRtf("- one\n- two");
    expect(rtf).toContain("\\bullet");
    expect(rtf).toContain("one");
    expect(rtf).toContain("two");
  });

  it("escapes braces, backslashes and non-ASCII from input", () => {
    const rtf = renderMarkdownToRtf("cost is 5€ {curly} back\\slash — dash");
    // No raw braces/backslash from the *input* leak through: the only
    // unescaped braces are the RTF groups, and the doc stays balanced.
    expect(braceBalance(rtf)).toBe(0);
    // The literal input characters are escaped.
    expect(rtf).toContain("\\{curly\\}");
    expect(rtf).toContain("back\\\\slash");
    // Non-ASCII escaped as \uN? (€ = 8364, — = 8212).
    expect(rtf).toContain("\\u8364?");
    expect(rtf).toContain("\\u8212?");
    // No raw non-ASCII byte survives.
    expect(/[^\x00-\x7f]/.test(rtf)).toBe(false);
  });
});

describe("renderMarkdownToHtml", () => {
  it("produces a self-contained print-styled document", () => {
    const html = renderMarkdownToHtml("# Hello", "My Doc");
    expect(html.toLowerCase()).toContain("<!doctype html");
    expect(html).toContain("<style>");
    expect(html).toContain("@media print");
    expect(html).toContain("<title>My Doc</title>");
  });

  it("renders headings and list items", () => {
    const html = renderMarkdownToHtml("# H1\n\n- item");
    expect(html).toContain("<h1>H1</h1>");
    expect(html).toContain("<li>item</li>");
  });

  it("escapes HTML-unsafe content", () => {
    const html = renderMarkdownToHtml("a <script>alert(1)</script> b");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("renders bold, italic and code inline", () => {
    const html = renderMarkdownToHtml("**b** *i* `c`");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<code>c</code>");
  });
});

describe("renderArtifact dispatch", () => {
  it("md returns content unchanged", () => {
    const content = "# Raw\n\n- untouched **markdown**";
    expect(renderArtifact("md", content)).toBe(content);
  });

  it("rtf and html dispatch to their renderers", () => {
    expect(renderArtifact("rtf", "# x").startsWith("{\\rtf1")).toBe(true);
    expect(renderArtifact("html", "# x").toLowerCase()).toContain("<!doctype html");
  });
});

describe("pathological input does not throw", () => {
  it("handles empty string", () => {
    expect(() => renderMarkdownToRtf("")).not.toThrow();
    expect(() => renderMarkdownToHtml("")).not.toThrow();
    expect(renderArtifact("md", "")).toBe("");
    // still a valid RTF shell
    const rtf = renderMarkdownToRtf("");
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(braceBalance(rtf)).toBe(0);
  });

  it("handles a very long line", () => {
    const long = "word ".repeat(100_000);
    expect(() => renderMarkdownToRtf(long)).not.toThrow();
    expect(() => renderMarkdownToHtml(long)).not.toThrow();
  });

  it("handles unbalanced emphasis markers", () => {
    const messy = "**unclosed bold and *dangling italic and `code";
    expect(() => renderMarkdownToRtf(messy)).not.toThrow();
    const rtf = renderMarkdownToRtf(messy);
    expect(braceBalance(rtf)).toBe(0);
    expect(() => renderMarkdownToHtml(messy)).not.toThrow();
  });

  it("handles an unterminated code fence", () => {
    expect(() => renderMarkdownToHtml("```\ncode without close")).not.toThrow();
    expect(() => renderMarkdownToRtf("```\ncode without close")).not.toThrow();
  });
});

// ── Links ──────────────────────────────────────────────────────────────────
//
// The tokenizer had no link support at all, so `[label](url)` reached the
// reader as those literal characters. That shipped in the report email, whose
// closing line is a markdown link to the full report: the one thing the message
// asks the recipient to do arrived as unclickable punctuation.

describe("markdown links", () => {
  const REPORT_LINK = "[View the full report](https://fundexecs.com/meetings/2va-cd7-mk/report)";

  it("makes an anchor in HTML", () => {
    const html = renderMarkdownToHtml(REPORT_LINK, "t");
    expect(html).toContain(
      '<a href="https://fundexecs.com/meetings/2va-cd7-mk/report">View the full report</a>',
    );
    // The whole point: no raw markdown left behind.
    expect(html).not.toContain("](https://");
  });

  it("keeps emphasis around a link", () => {
    // The anchor wraps the emphasis rather than the other way round; both nest
    // legally, and this pins which one so a refactor cannot quietly drop one.
    expect(renderMarkdownToHtml("**[docs](https://example.com)**", "t"))
      .toContain('<a href="https://example.com"><strong>docs</strong></a>');
  });

  it("escapes the URL as an attribute value", () => {
    const html = renderMarkdownToHtml('[x](https://example.com/?a=1&b="2")', "t");
    expect(html).toContain("&amp;");
    expect(html).not.toContain('b="2"');
  });

  it("refuses a scheme a browser would execute", () => {
    // Report bodies are model output. An anchor is the one place where a
    // javascript: URL stops being text and starts being code, so these stay
    // literal rather than becoming links.
    for (const bad of [
      "[click](javascript:alert(1))",
      "[click](data:text/html,<script>alert(1)</script>)",
      "[click](vbscript:msgbox)",
    ]) {
      const html = renderMarkdownToHtml(bad, "t");
      expect(html).not.toContain("<a ");
    }
  });

  it("allows mailto", () => {
    expect(renderMarkdownToHtml("[write](mailto:a@b.com)", "t"))
      .toContain('<a href="mailto:a@b.com">write</a>');
  });

  it("leaves prose brackets alone", () => {
    for (const prose of [
      "The figure [3] is wrong.",
      "See [the appendix] for detail.",
      "[unclosed(https://example.com",
      "[](https://example.com)",
      "[label]()",
      "[a](https://exa mple.com)",
    ]) {
      const html = renderMarkdownToHtml(prose, "t");
      expect(html).not.toContain("<a ");
    }
  });

  it("prints the URL in RTF, which cannot anchor it", () => {
    const rtf = renderMarkdownToRtf(REPORT_LINK, "t");
    expect(rtf).toContain("View the full report");
    expect(rtf).toContain("https://fundexecs.com/meetings/2va-cd7-mk/report");
    // Never the raw markdown.
    expect(rtf).not.toContain("](");
  });
});
