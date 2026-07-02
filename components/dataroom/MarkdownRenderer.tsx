// Native markdown renderer — zero external dependencies.
// Handles: headings (H1–H3), bold, italic, inline code, code blocks,
// blockquotes, unordered/ordered lists, horizontal rules, and paragraphs.
// Does NOT eval or allow unsafe HTML injection.

import React from "react";

type Token =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "codeblock"; lang: string; text: string }
  | { kind: "blockquote"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" }
  | { kind: "blank" }
  | { kind: "para"; text: string };

function tokenize(md: string): Token[] {
  const lines = md.split("\n");
  const tokens: Token[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++;
      tokens.push({ kind: "codeblock", lang, text: body.join("\n") });
      continue;
    }

    // Heading
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      tokens.push({ kind: "heading", level: hm[1].length as 1 | 2 | 3, text: hm[2] });
      i++;
      continue;
    }

    // HR
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      tokens.push({ kind: "hr" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const bq: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        bq.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      tokens.push({ kind: "blockquote", lines: bq });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s/, ""));
        i++;
      }
      tokens.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ""));
        i++;
      }
      tokens.push({ kind: "ol", items });
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      tokens.push({ kind: "blank" });
      i++;
      continue;
    }

    // Paragraph — accumulate adjacent non-blank, non-special lines
    const paras: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith(">") &&
      !lines[i].startsWith("```") &&
      !/^[-*+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      paras.push(lines[i]);
      i++;
    }
    if (paras.length) tokens.push({ kind: "para", text: paras.join(" ") });
  }

  return tokens;
}

// Render inline markdown: **bold**, *italic*, `code`, and plain text.
function Inline({ text }: { text: string }): React.ReactNode {
  // Split on bold (**...**), italic (*...*), and inline code (`...`)
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={m.index} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-fg-secondary">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={m.index}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  const tokens = tokenize(content);

  return (
    <div className={`space-y-3 text-sm leading-relaxed text-fg-secondary ${className ?? ""}`}>
      {tokens.map((tok, idx) => {
        if (tok.kind === "blank") return null;

        if (tok.kind === "heading") {
          const cls =
            tok.level === 1
              ? "font-display text-xl font-semibold text-fg-primary mt-6 first:mt-0"
              : tok.level === 2
                ? "font-display text-base font-semibold text-fg-primary mt-5 first:mt-0"
                : "font-mono text-[11px] uppercase tracking-widest text-gold-400 mt-4 first:mt-0";
          return <p key={idx} className={cls}><Inline text={tok.text} /></p>;
        }

        if (tok.kind === "para") {
          return (
            <p key={idx} className="text-fg-secondary">
              <Inline text={tok.text} />
            </p>
          );
        }

        if (tok.kind === "codeblock") {
          return (
            <pre key={idx} className="overflow-x-auto rounded-xl border border-line bg-surface-0 p-4 font-mono text-xs text-fg-secondary">
              <code>{tok.text}</code>
            </pre>
          );
        }

        if (tok.kind === "blockquote") {
          return (
            <blockquote key={idx} className="border-l-2 border-gold-500/40 pl-4 italic text-fg-muted">
              {tok.lines.map((l, li) => <p key={li}><Inline text={l} /></p>)}
            </blockquote>
          );
        }

        if (tok.kind === "ul") {
          return (
            <ul key={idx} className="space-y-1 pl-5 text-fg-secondary" style={{ listStyleType: "disc" }}>
              {tok.items.map((item, ii) => (
                <li key={ii}><Inline text={item} /></li>
              ))}
            </ul>
          );
        }

        if (tok.kind === "ol") {
          return (
            <ol key={idx} className="space-y-1 pl-5 text-fg-secondary" style={{ listStyleType: "decimal" }}>
              {tok.items.map((item, ii) => (
                <li key={ii}><Inline text={item} /></li>
              ))}
            </ol>
          );
        }

        if (tok.kind === "hr") {
          return <hr key={idx} className="border-line" />;
        }

        return null;
      })}
    </div>
  );
}
