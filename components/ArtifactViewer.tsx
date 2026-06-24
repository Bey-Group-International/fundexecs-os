"use client";

import { useState } from "react";
import type { ArtifactType, Json } from "@/lib/supabase/database.types";
import { ArtifactModal } from "@/components/ArtifactModal";
import { parseSources, verificationView, type VerificationLevel } from "@/lib/artifact-provenance";
import type { SealStatus } from "@/lib/attestation-seal";

// Verification badge palette — verified (signed off) / grounded (cites sources,
// unsigned) / unverified (no sources).
const VERIFY_TONE: Record<VerificationLevel, string> = {
  verified: "border-status-success/45 bg-status-success/[0.08] text-status-success",
  grounded: "border-gold-500/40 bg-gold-500/[0.07] text-gold-300",
  unverified: "border-line/70 bg-surface-2/50 text-fg-muted",
};

// A recomputed-seal chip. Only "sealed" / "tampered" render — "tampered" is loud
// (it means the signed content changed since sign-off); unsealed shows nothing.
function SealChip({ status }: { status?: SealStatus }) {
  if (status === "sealed") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-status-success/45 bg-status-success/[0.08] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success"
        title="Tamper-evident — the seal was recomputed and matches the signed content."
      >
        🔒 Sealed
      </span>
    );
  }
  if (status === "tampered") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-status-danger/55 bg-status-danger/[0.12] px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-status-danger"
        title="The seal no longer matches — the signed content changed after sign-off. Re-verify before relying on it."
      >
        ⚠ Seal broken
      </span>
    );
  }
  return null;
}

// Provenance bar — a verification badge plus the openable grounding citations
// that make a composer output verifiable. Renders the badge always; the sources
// list expands on demand.
export function ProvenanceBar({
  sources,
  verificationStatus,
  groundingScore,
  sealStatus,
}: {
  sources?: Json | null;
  verificationStatus?: string | null;
  groundingScore?: number | null;
  sealStatus?: SealStatus;
}) {
  const [open, setOpen] = useState(false);
  const cited = parseSources(sources);
  const view = verificationView({ verification_status: verificationStatus, sources, grounding_score: groundingScore });

  return (
    <div className="mt-2 border-t border-line/55 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${VERIFY_TONE[view.level]}`}
          title={view.detail}
        >
          {view.level === "verified" ? "✓ " : null}
          {view.label}
        </span>
        <SealChip status={sealStatus} />
        {cited.length ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
          >
            {open ? "Hide sources" : `${cited.length} source${cited.length === 1 ? "" : "s"}`}
          </button>
        ) : (
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{view.detail}</span>
        )}
      </div>

      {open && cited.length ? (
        <ol className="mt-2 space-y-1.5">
          {cited.map((s, i) => (
            <li key={`${s.source}-${i}`} className="rounded-lg border border-line/60 bg-surface-0/40 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[10px] text-fg-secondary">{s.source}</span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {s.kind === "kb" ? "KB" : "Doc"}
                  {s.score > 0 ? ` · ${(s.score * 100).toFixed(0)}%` : ""}
                </span>
              </div>
              {s.snippet ? <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-muted">{s.snippet}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

// Memo-style deliverables read best as markdown documents (.md); everything else
// (models, plain summaries) downloads as a generic text file.
const MARKDOWN_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  "ic_memo",
  "memo",
  "analysis",
  "risk_report",
  "lp_update",
]);

// Turn an artifact label/title into a safe, lowercase file stem.
function sanitizeFilename(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem || "artifact";
}

function downloadArtifact(content: string, title: string, artifactType?: ArtifactType) {
  const ext = artifactType && MARKDOWN_TYPES.has(artifactType) ? "md" : "txt";
  const blob = new Blob([content], { type: ext === "md" ? "text/markdown" : "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(title)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Shared toolbar for per-artifact actions: copy to clipboard, download, expand.
function ArtifactActions({
  content,
  title,
  artifactType,
  onExpand,
}: {
  content: string;
  title: string;
  artifactType?: ArtifactType;
  onExpand?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const btn =
    "rounded-md border border-line/70 bg-surface-0/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-fg-primary";
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(content).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            },
            () => {},
          );
        }}
        className={btn}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button type="button" onClick={() => downloadArtifact(content, title, artifactType)} className={btn}>
        Download
      </button>
      {onExpand ? (
        <button type="button" onClick={onExpand} className={btn}>
          Expand ⤢
        </button>
      ) : null}
    </div>
  );
}

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
            <span className="min-w-0 break-words text-fg-secondary">{formatInline(match[2], `kv-${i}`)}</span>
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
  // Trust layer: grounding citations + verification badge.
  sources?: Json | null;
  verificationStatus?: string | null;
  groundingScore?: number | null;
  sealStatus?: SealStatus;
}

export function ArtifactCard({
  title,
  content,
  artifact_type,
  agent,
  created_at,
  compact = false,
  sources,
  verificationStatus,
  groundingScore,
  sealStatus,
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
          {sources !== undefined || verificationStatus !== undefined ? (
            <ProvenanceBar
              sources={sources}
              verificationStatus={verificationStatus}
              groundingScore={groundingScore}
              sealStatus={sealStatus}
            />
          ) : null}
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
export function ArtifactInline({
  content,
  artifactType,
  title,
  sources,
  verificationStatus,
  groundingScore,
  sealStatus,
}: {
  content: string;
  artifactType?: ArtifactType;
  title?: string;
  // Trust layer: grounding citations + verification badge for this deliverable.
  sources?: Json | null;
  verificationStatus?: string | null;
  groundingScore?: number | null;
  sealStatus?: SealStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const lines = content.split("\n").filter(Boolean);
  const isLong = lines.length > 8;
  const label = artifactType ? ARTIFACT_LABEL[artifactType] : undefined;
  const fileTitle = title?.trim() || label || "Artifact";

  return (
    <div className="group/artifact mt-2 overflow-hidden rounded-lg border border-line bg-surface-0 px-4 py-3">
      <div className="mb-2 flex items-center justify-end opacity-0 transition group-hover/artifact:opacity-100 focus-within:opacity-100">
        <ArtifactActions
          content={content}
          title={fileTitle}
          artifactType={artifactType}
          onExpand={() => setModalOpen(true)}
        />
      </div>
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
      {sources !== undefined || verificationStatus !== undefined ? (
        <ProvenanceBar
          sources={sources}
          verificationStatus={verificationStatus}
          groundingScore={groundingScore}
          sealStatus={sealStatus}
        />
      ) : null}
      {modalOpen && (
        <ArtifactModal
          title={fileTitle}
          label={label}
          content={content}
          onClose={() => setModalOpen(false)}
          toolbar={
            <ArtifactActions content={content} title={fileTitle} artifactType={artifactType} />
          }
        />
      )}
    </div>
  );
}
