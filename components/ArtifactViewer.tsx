"use client";

import { useState } from "react";
import type { ArtifactType } from "@/lib/supabase/database.types";

export const ARTIFACT_LABEL: Record<ArtifactType, string> = {
  ic_memo: "IC Memo",
  model: "Model",
  analysis: "Analysis",
  risk_report: "Risk Report",
  lp_update: "LP Update",
  memo: "Memo",
  summary: "Summary",
  other: "Artifact",
};

const TYPE_COLOR: Record<ArtifactType, string> = {
  ic_memo: "text-gold-300 border-gold-500/40 bg-gold-500/10",
  model: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  analysis: "text-blue-400 border-blue-500/40 bg-blue-500/10",
  risk_report: "text-red-400 border-red-500/40 bg-red-500/10",
  lp_update: "text-purple-400 border-purple-500/40 bg-purple-500/10",
  memo: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  summary: "text-sky-400 border-sky-500/40 bg-sky-500/10",
  other: "text-fg-muted border-line bg-surface-2",
};

// Render inline emphasis (**bold** / __bold__) so the markers never leak into
// the displayed copy — the institutional read is the words, not the syntax.
function formatInline(text: string, keyPrefix: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);
  return parts.map((part, idx) => {
    const bold = part.match(/^(?:\*\*|__)([\s\S]+?)(?:\*\*|__)$/);
    if (bold) {
      return (
        <strong key={`${keyPrefix}-${idx}`} className="font-semibold text-fg-primary">
          {bold[1]}
        </strong>
      );
    }
    return part;
  });
}

// A pipe table row is `| ... |`; the separator under the header is `|---|---|`.
const isTableRow = (line: string) => {
  const t = line.trim();
  return t.startsWith("|") && t.indexOf("|", 1) !== -1;
};
const isTableSeparator = (line: string) => {
  const t = line.trim();
  return t.includes("-") && /^\|?[\s:|-]+\|?$/.test(t);
};
const splitRow = (line: string): string[] => {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
};

function renderContent(content: string): React.ReactNode[] {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Pipe table — lift the grid out of the raw markdown into a real table.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2; // consume the header and its separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      nodes.push(
        <div key={`tbl-${i}`} className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-fg-muted"
                  >
                    {formatInline(h, `th-${i}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-line/60 last:border-0">
                  {header.map((_, ci) => (
                    <td key={ci} className="px-3 py-2 align-top text-fg-secondary">
                      {formatInline(r[ci] ?? "", `td-${i}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // H1 / H2 / H3
    if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={i} className="mt-4 text-sm font-semibold text-fg-primary">
          {formatInline(line.slice(4), `h3-${i}`)}
        </h3>
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={i} className="mt-5 text-base font-semibold text-fg-primary">
          {formatInline(line.slice(3), `h2-${i}`)}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={i} className="mt-2 text-lg font-semibold text-fg-primary">
          {formatInline(line.slice(2), `h1-${i}`)}
        </h1>
      );
      i++;
      continue;
    }

    // Bullet list — collect consecutive bullets
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="mt-2 space-y-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-sm text-fg-secondary">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold-400" />
              <span>{formatInline(item, `li-${i}-${j}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Bold key-value line (e.g. "**IRR:** 18.4%")
    if (line.startsWith("**") && line.includes(":**")) {
      const match = line.match(/^\*\*(.+?):\*\*\s*(.*)/);
      if (match) {
        nodes.push(
          <div key={i} className="mt-2 flex gap-2 text-sm">
            <span className="font-semibold text-fg-primary shrink-0">{match[1]}:</span>
            <span className="text-fg-secondary">{formatInline(match[2], `kv-${i}`)}</span>
          </div>
        );
        i++;
        continue;
      }
    }

    // Whole-line bold (e.g. "**Outreach Templates**") reads as a section title,
    // not literal asterisks around the text.
    const wholeBold = line.trim().match(/^\*\*([\s\S]+)\*\*$/);
    if (wholeBold) {
      nodes.push(
        <h3 key={i} className="mt-4 text-sm font-semibold text-fg-primary">
          {wholeBold[1]}
        </h3>
      );
      i++;
      continue;
    }

    // Horizontal rule (---, ***, ___)
    if (/^[-*_]{3,}$/.test(line.trim())) {
      nodes.push(<hr key={i} className="my-4 border-line" />);
      i++;
      continue;
    }

    // Plain paragraph
    nodes.push(
      <p key={i} className="mt-2 text-sm leading-relaxed text-fg-secondary">
        {formatInline(line, `p-${i}`)}
      </p>
    );
    i++;
  }

  return nodes;
}

interface ArtifactCardProps {
  id: string;
  title: string;
  content: string;
  artifact_type: ArtifactType;
  agent?: string;
  created_at?: string;
  compact?: boolean;
}

export function ArtifactCard({
  title,
  content,
  artifact_type,
  agent,
  created_at,
  compact = false,
}: ArtifactCardProps) {
  const [expanded, setExpanded] = useState(false);
  const label = ARTIFACT_LABEL[artifact_type] ?? "Artifact";
  const color = TYPE_COLOR[artifact_type] ?? TYPE_COLOR.other;
  const date = created_at ? new Date(created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;

  return (
    <article className="rounded-xl border border-line bg-surface-1 transition hover:border-gold-500/20">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${color}`}>
            {label}
          </span>
          {agent && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{agent}</span>
          )}
          {date && (
            <span className="ml-auto font-mono text-[9px] text-fg-muted">{date}</span>
          )}
        </div>
        <p className="mt-1.5 text-sm font-medium text-fg-primary">{title}</p>
        {!expanded && (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-muted">{content}</p>
        )}
      </button>

      {expanded && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <div className={`space-y-0 ${compact ? "max-h-80 overflow-y-auto" : ""}`}>
            {renderContent(content)}
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="mt-4 font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
          >
            Collapse ↑
          </button>
        </div>
      )}
    </article>
  );
}

// Inline viewer for Copilot step output (no card chrome, just the formatted text)
export function ArtifactInline({ content, artifactType }: { content: string; artifactType?: ArtifactType }) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n").filter(Boolean);
  const isLong = lines.length > 8;

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-0 px-4 py-3">
      <div className={`${!expanded && isLong ? "max-h-40 overflow-hidden" : ""} relative`}>
        {renderContent(content)}
        {!expanded && isLong && (
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-0 to-transparent" />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:text-gold-300"
        >
          {expanded ? "Collapse ↑" : "Read full output ↓"}
        </button>
      )}
    </div>
  );
}
