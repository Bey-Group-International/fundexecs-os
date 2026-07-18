// Dependency-free artifact document export. Turns an artifact's markdown
// `content` into downloadable documents: RTF (opens natively in Word / Pages /
// Google Docs), print-styled HTML (the "print to PDF" path), and raw Markdown.
//
// Everything here is a pure string transform — no I/O, no npm deps. The
// markdown subset is hand-rolled and line-based so it can never blow up on
// pathological input: no backtracking regexes, no recursion on user text. On
// anything it doesn't understand it degrades to escaped plain text rather than
// throwing.

export type ExportFormat = "rtf" | "html" | "md";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  rtf: "application/rtf",
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export function exportExtension(f: ExportFormat): string {
  return f;
}

export function isExportFormat(v: string): v is ExportFormat {
  return v === "rtf" || v === "html" || v === "md";
}

// ---------------------------------------------------------------------------
// Line-based block parser
// ---------------------------------------------------------------------------
//
// We classify each line into a small set of block tokens. Inline styling
// (bold / italic / code) is resolved separately, per line, into spans.

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "blockquote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "hr" };

// Guardrail: cap how much input we will ever look at so a multi-megabyte body
// can't turn an export into a denial-of-service. Well past any real artifact.
const MAX_INPUT = 2_000_000;

function parseBlocks(markdown: string): Block[] {
  const src =
    typeof markdown === "string"
      ? markdown.length > MAX_INPUT
        ? markdown.slice(0, MAX_INPUT)
        : markdown
      : "";

  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];

  let inCode = false;
  let codeBuf: string[] = [];
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length) {
      blocks.push({ kind: "paragraph", text: paraBuf.join(" ") });
      paraBuf = [];
    }
  };

  for (const raw of lines) {
    const line = raw;

    // Fenced code blocks: ``` toggles. Everything inside is verbatim.
    if (/^\s*```/.test(line)) {
      if (inCode) {
        blocks.push({ kind: "code", text: codeBuf.join("\n") });
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Blank line ends a paragraph.
    if (trimmed === "") {
      flushPara();
      continue;
    }

    // Horizontal rule: --- or *** (three or more) on its own line.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ kind: "hr" });
      continue;
    }

    // Headings: #, ##, ### (deeper levels clamp to 3).
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara();
      const level = Math.min(h[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: h[2].trim() });
      continue;
    }

    // Bullet list item: -, * or + followed by a space.
    const b = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (b) {
      flushPara();
      blocks.push({ kind: "bullet", text: b[1].trim() });
      continue;
    }

    // Blockquote: > text.
    const q = /^>\s?(.*)$/.exec(trimmed);
    if (q) {
      flushPara();
      blocks.push({ kind: "blockquote", text: q[1].trim() });
      continue;
    }

    // Otherwise: accumulate into the current paragraph.
    paraBuf.push(trimmed);
  }

  if (inCode) {
    // Unterminated fence — emit what we collected so nothing is lost.
    blocks.push({ kind: "code", text: codeBuf.join("\n") });
  }
  flushPara();

  return blocks;
}

// ---------------------------------------------------------------------------
// Inline span tokenizer
// ---------------------------------------------------------------------------
//
// Resolves **bold**, *italic* (or _italic_) and `code` into a flat list of
// spans. Single-pass character scan — no regex backtracking, and any unmatched
// marker is treated as literal text so unbalanced `**` never throws or hangs.

type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const s = text;
  const n = s.length;

  let i = 0;
  let buf = "";
  let bold = false;
  let italic = false;

  const push = () => {
    if (buf) {
      spans.push({ text: buf, bold: bold || undefined, italic: italic || undefined });
      buf = "";
    }
  };

  // Whether a matching closing marker exists ahead — only then do we treat the
  // marker as styling; otherwise it's a literal character.
  const hasCloser = (marker: string, from: number): boolean =>
    s.indexOf(marker, from) !== -1;

  while (i < n) {
    const c = s[i];

    // Inline code `...` — verbatim, wins over emphasis.
    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end !== -1) {
        push();
        spans.push({ text: s.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
      // No closer: literal backtick.
      buf += c;
      i += 1;
      continue;
    }

    // Bold **...** (check before single-* italic).
    if (c === "*" && s[i + 1] === "*") {
      if (!bold && hasCloser("**", i + 2)) {
        push();
        bold = true;
        i += 2;
        continue;
      }
      if (bold) {
        push();
        bold = false;
        i += 2;
        continue;
      }
      buf += "**";
      i += 2;
      continue;
    }

    // Italic *...* or _..._
    if (c === "*" || c === "_") {
      if (!italic && hasCloser(c, i + 1)) {
        push();
        italic = true;
        i += 1;
        continue;
      }
      if (italic) {
        push();
        italic = false;
        i += 1;
        continue;
      }
      buf += c;
      i += 1;
      continue;
    }

    buf += c;
    i += 1;
  }

  push();
  return spans;
}

// ---------------------------------------------------------------------------
// HTML renderer
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineToHtml(text: string): string {
  return parseInline(text)
    .map((sp) => {
      let out = escapeHtml(sp.text);
      if (sp.code) return `<code>${out}</code>`;
      if (sp.bold) out = `<strong>${out}</strong>`;
      if (sp.italic) out = `<em>${out}</em>`;
      return out;
    })
    .join("");
}

const HTML_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #1a1a1a;
    background: #fff;
    max-width: 7.5in;
    margin: 1in auto;
    padding: 0 0.25in;
  }
  h1, h2, h3 { font-family: "Helvetica Neue", Arial, sans-serif; line-height: 1.25; margin: 1.2em 0 0.4em; }
  h1 { font-size: 22pt; }
  h2 { font-size: 17pt; }
  h3 { font-size: 14pt; }
  p { margin: 0 0 0.8em; }
  ul { margin: 0 0 0.8em 1.4em; padding: 0; }
  li { margin: 0.2em 0; }
  blockquote {
    margin: 0 0 0.8em; padding: 0.2em 1em;
    border-left: 3px solid #ccc; color: #555; font-style: italic;
  }
  pre {
    background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 4px;
    padding: 0.8em 1em; overflow-x: auto;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 10.5pt; line-height: 1.4;
  }
  code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 0.9em; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }
  @media print {
    body { margin: 0; max-width: none; font-size: 11pt; }
    h1, h2, h3 { page-break-after: avoid; }
    pre, blockquote, li { page-break-inside: avoid; }
    @page { margin: 1in; }
  }
`;

export function renderMarkdownToHtml(markdown: string, title?: string): string {
  const blocks = parseBlocks(markdown);
  const docTitle = title && title.trim() ? title.trim() : "Document";

  const parts: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const blk = blocks[i];
    switch (blk.kind) {
      case "heading":
        parts.push(`<h${blk.level}>${inlineToHtml(blk.text)}</h${blk.level}>`);
        i += 1;
        break;
      case "bullet": {
        const items: string[] = [];
        while (i < blocks.length && blocks[i].kind === "bullet") {
          items.push(`<li>${inlineToHtml((blocks[i] as { text: string }).text)}</li>`);
          i += 1;
        }
        parts.push(`<ul>\n${items.join("\n")}\n</ul>`);
        break;
      }
      case "blockquote":
        parts.push(`<blockquote>${inlineToHtml(blk.text)}</blockquote>`);
        i += 1;
        break;
      case "code":
        parts.push(`<pre><code>${escapeHtml(blk.text)}</code></pre>`);
        i += 1;
        break;
      case "hr":
        parts.push("<hr>");
        i += 1;
        break;
      case "paragraph":
        parts.push(`<p>${inlineToHtml(blk.text)}</p>`);
        i += 1;
        break;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
${parts.join("\n")}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// RTF renderer
// ---------------------------------------------------------------------------
//
// Minimal, valid RTF 1.0. We escape the RTF control characters (\ { }) and any
// non-ASCII codepoint as \uN? escapes so the output is pure ASCII and opens in
// Word / Pages / Google Docs.

function escapeRtf(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === "\\") out += "\\\\";
    else if (ch === "{") out += "\\{";
    else if (ch === "}") out += "\\}";
    else if (ch === "\t") out += "\\tab ";
    else if (ch === "\n") out += "\\line ";
    else if (code < 128) out += ch;
    else {
      // RTF \uN? — N is a signed 16-bit decimal; ? is the ASCII fallback.
      const signed = code > 32767 ? code - 65536 : code;
      out += `\\u${signed}?`;
    }
  }
  return out;
}

function inlineToRtf(text: string): string {
  return parseInline(text)
    .map((sp) => {
      const esc = escapeRtf(sp.text);
      if (sp.code) return `{\\f1 ${esc}}`;
      let group = esc;
      if (sp.bold && sp.italic) return `{\\b\\i ${group}}`;
      if (sp.bold) return `{\\b ${group}}`;
      if (sp.italic) return `{\\i ${group}}`;
      return group;
    })
    .join("");
}

// Heading font sizes in half-points (\fsNN). H1=32 → 16pt, etc.
const RTF_HEADING_FS: Record<1 | 2 | 3, number> = { 1: 36, 2: 30, 3: 26 };

export function renderMarkdownToRtf(markdown: string, title?: string): string {
  const blocks = parseBlocks(markdown);

  const header =
    "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
    "{\\fonttbl{\\f0\\froman Georgia;}{\\f1\\fmodern Consolas;}}" +
    "\\fs24\n";

  const body: string[] = [];

  if (title && title.trim()) {
    body.push(`{\\b\\fs40 ${escapeRtf(title.trim())}}\\par\\par`);
  }

  let i = 0;
  while (i < blocks.length) {
    const blk = blocks[i];
    switch (blk.kind) {
      case "heading": {
        const fs = RTF_HEADING_FS[blk.level];
        body.push(`{\\b\\fs${fs} ${inlineToRtf(blk.text)}}\\par`);
        i += 1;
        break;
      }
      case "bullet":
        body.push(`{\\bullet\\tab ${inlineToRtf(blk.text)}}\\par`);
        i += 1;
        break;
      case "blockquote":
        body.push(`{\\i\\li360 ${inlineToRtf(blk.text)}}\\par`);
        i += 1;
        break;
      case "code": {
        const codeLines = escapeRtf(blk.text);
        body.push(`{\\f1 ${codeLines}}\\par`);
        i += 1;
        break;
      }
      case "hr":
        body.push("\\brdrb\\brdrs\\brdrw10\\par\\par");
        i += 1;
        break;
      case "paragraph":
        body.push(`${inlineToRtf(blk.text)}\\par`);
        i += 1;
        break;
    }
  }

  return header + body.join("\n") + "\n}";
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function renderArtifact(format: ExportFormat, content: string, title?: string): string {
  const src = typeof content === "string" ? content : "";
  switch (format) {
    case "rtf":
      return renderMarkdownToRtf(src, title);
    case "html":
      return renderMarkdownToHtml(src, title);
    case "md":
      return src;
  }
}
