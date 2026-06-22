"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders Earn's answers as markdown, styled to the app's tokens — headings,
// bold, lists, tables, links, and fenced code with a copy button. Kept small and
// dependency-light (react-markdown + remark-gfm only) so it stays fast while a
// reply streams in token by token.

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  return (
    <div className="group relative my-2">
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            },
            () => {},
          );
        }}
        className="absolute right-2 top-2 rounded-md border border-line/70 bg-surface-0/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted opacity-0 transition hover:text-fg-primary group-hover:opacity-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-xl border border-line/70 bg-surface-0/60 p-3 text-[13px] leading-6 text-fg-primary">
        {children}
      </pre>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-1 font-display text-lg font-semibold text-fg-primary">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-2 font-display text-base font-semibold text-fg-primary">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-fg-primary">{children}</h3>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-gold-300 underline underline-offset-2 hover:text-gold-200">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-fg-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-gold-500/40 pl-3 text-fg-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-line/70" />,
  code: ({ className, children }) => {
    // Inline code has no language class and no newline; block code is wrapped by `pre`.
    const isInline = !className && !String(children).includes("\n");
    if (isInline) {
      return (
        <code className="rounded border border-line/60 bg-surface-0/70 px-1 py-0.5 font-mono text-[12px] text-gold-200">
          {children}
        </code>
      );
    }
    return <code className={className}>{children}</code>;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-line/70 text-left text-fg-muted">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-line/40 px-2 py-1 align-top">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-6 text-fg-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
