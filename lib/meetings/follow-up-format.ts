// lib/meetings/follow-up-format.ts
// The follow-up's formatting: what the editor's toolbar writes, and what an
// email and the preview render it as.
//
// Deliberately small. A follow-up is an email, so it gets what an email needs —
// bold, italics, bulleted and numbered lists — written as the plain-text marks
// people already type (`**bold**`, `_italic_`, `- item`, `1. item`). A draft is
// still readable as text wherever it lands untransformed, which matters because
// the inbox composer shows it as text.
//
// Everything is escaped BEFORE any mark is turned into a tag, so nothing a
// model wrote or a host typed can become markup of its own. That ordering is
// the whole safety argument; keep it.
//
// Pure: no DOM, no mailer.

export function escapeFollowUpHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** `**bold**` and `_italic_`, on text that is already escaped. */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    // Underscores only as marks when they stand at a word's edges, so an
    // address like first_last@fund.test is left exactly as it is.
    .replace(/(^|[\s(])_(?=\S)([^_\n]+?)(?<=\S)_(?=$|[\s.,;:!?)])/g, "$1<em>$2</em>");
}

/** One rendered block, tagged with what kind it is so a caller can style it. */
export type FollowUpBlock =
  | { kind: "p"; html: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

/**
 * The body as blocks: paragraphs (line breaks kept), bulleted lists, numbered
 * lists. A blank line separates paragraphs; consecutive list lines become one
 * list even inside a paragraph, so a model's "Action items:\n1. …\n2. …" renders
 * as a heading line followed by a list.
 */
export function followUpBlocks(body: string): FollowUpBlock[] {
  const blocks: FollowUpBlock[] = [];
  for (const chunk of (body ?? "").split(/\n{2,}/)) {
    const lines = chunk.split("\n");
    let para: string[] = [];
    let list: { kind: "ul" | "ol"; items: string[] } | null = null;

    const flushPara = () => {
      const text = para.join("\n").trim();
      if (text) blocks.push({ kind: "p", html: inline(escapeFollowUpHtml(text)).replace(/\n/g, "<br />") });
      para = [];
    };
    const flushList = () => {
      if (list && list.items.length) blocks.push(list);
      list = null;
    };

    for (const line of lines) {
      const bullet = BULLET.exec(line);
      const numbered = bullet ? null : NUMBERED.exec(line);
      const kind = bullet ? "ul" : numbered ? "ol" : null;
      if (kind) {
        flushPara();
        if (!list || list.kind !== kind) {
          flushList();
          list = { kind, items: [] };
        }
        list.items.push(inline(escapeFollowUpHtml((bullet ?? numbered)![1])));
      } else {
        flushList();
        para.push(line);
      }
    }
    flushList();
    flushPara();
  }
  return blocks;
}

/** The body as HTML, with the inline styles a mail client will honour. */
export function followUpBodyHtml(body: string, style: { p: string; list: string; li: string }): string {
  return followUpBlocks(body)
    .map((block) => {
      if (block.kind === "p") return `<p style="${style.p}">${block.html}</p>`;
      const items = block.items.map((item) => `<li style="${style.li}">${item}</li>`).join("");
      return `<${block.kind} style="${style.list}">${items}</${block.kind}>`;
    })
    .join("\n  ");
}

/**
 * The body without its emphasis marks, for places that show text as text — the
 * inbox composer. Lists stay as they are: "- item" reads as a list in plain text.
 */
export function plainFollowUp(body: string): string {
  return (body ?? "")
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "$1")
    .replace(/(^|[\s(])_(?=\S)([^_\n]+?)(?<=\S)_(?=$|[\s.,;:!?)])/g, "$1$2");
}

/** What a toolbar press does to the text and where the selection lands after. */
export interface Edit {
  text: string;
  start: number;
  end: number;
}

/** Wrap the selection in a mark, or insert an empty pair with the caret inside. */
export function wrapSelection(text: string, start: number, end: number, mark: "**" | "_"): Edit {
  const selected = text.slice(start, end);
  const next = `${text.slice(0, start)}${mark}${selected}${mark}${text.slice(end)}`;
  return { text: next, start: start + mark.length, end: end + mark.length };
}

/**
 * Turn the lines the selection touches into a list, or back into plain lines
 * when they already are one of that kind.
 */
export function toggleList(text: string, start: number, end: number, kind: "ul" | "ol"): Edit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const pattern = kind === "ul" ? BULLET : NUMBERED;
  const already = lines.every((line) => !line.trim() || pattern.test(line));

  const changed = lines.map((line, i) => {
    if (!line.trim()) return line;
    const bare = line.replace(BULLET, "$1").replace(NUMBERED, "$1");
    if (already) return bare;
    return kind === "ul" ? `- ${bare}` : `${i + 1}. ${bare}`;
  });
  const block = changed.join("\n");
  return {
    text: `${text.slice(0, lineStart)}${block}${text.slice(lineEnd)}`,
    start: lineStart,
    end: lineStart + block.length,
  };
}
