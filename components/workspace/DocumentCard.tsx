// components/workspace/DocumentCard.tsx
// Knowledge workspace document card — Notion-style doc listing.
"use client";

import Link from "next/link";
import { DOC_TYPE_LABELS, DOC_TYPE_ICONS, DOC_TYPE_COLORS, countWords } from "@/lib/workspace";
import type { Block, DocType } from "@/lib/workspace";

interface WorkspaceDoc {
  id: string;
  title: string;
  docType: DocType;
  blocks: Block[];
  isPinned: boolean;
  updatedAt: string;
  dealName?: string;
  fundName?: string;
  createdByName?: string;
}

function timeLabel(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const d = Math.floor(ms / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

export function DocumentCard({ doc }: { doc: WorkspaceDoc }) {
  const iconColor = DOC_TYPE_COLORS[doc.docType];
  const words = countWords(doc.blocks);
  const firstParagraph = doc.blocks.find((b) => b.type === "paragraph")?.content;

  return (
    <Link
      href={`/document/${doc.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/30 hover:bg-surface-2/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-base ${iconColor}`} aria-hidden>{DOC_TYPE_ICONS[doc.docType]}</span>
          <span className={`rounded-full border border-current/30 bg-current/8 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${iconColor}`}>
            {DOC_TYPE_LABELS[doc.docType]}
          </span>
        </div>
        {doc.isPinned && (
          <span className="font-mono text-[10px] text-gold-400">Pinned</span>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-fg-primary group-hover:text-gold-100 transition">
          {doc.title}
        </p>
        {firstParagraph && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-secondary">
            {firstParagraph}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 font-mono text-[10px] text-fg-muted">
        {doc.dealName && <span className="text-gold-400/70">{doc.dealName}</span>}
        {doc.fundName && <span className="text-blue-400/70">{doc.fundName}</span>}
        <span className="ml-auto">{words} words · {timeLabel(doc.updatedAt)}</span>
      </div>
    </Link>
  );
}

// Document list / grid
export function WorkspaceDocumentList({ docs }: { docs: WorkspaceDoc[] }) {
  if (docs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-10 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">No documents yet</p>
        <p className="mt-1 text-xs text-fg-secondary">
          Start from a template or create a blank note.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/build/data_room" className="fx-btn-primary">
            Open Data Room
          </Link>
          <Link href="/workspace" className="fx-btn-secondary">
            Ask Earn
          </Link>
        </div>
      </div>
    );
  }

  const pinned = docs.filter((d) => d.isPinned);
  const rest = docs.filter((d) => !d.isPinned);

  return (
    <div className="flex flex-col gap-6">
      {pinned.length > 0 && (
        <section>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-fg-muted">Pinned</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pinned.map((doc) => <DocumentCard key={doc.id} doc={doc} />)}
          </div>
        </section>
      )}
      <section>
        {pinned.length > 0 && (
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-fg-muted">All Documents</h3>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((doc) => <DocumentCard key={doc.id} doc={doc} />)}
        </div>
      </section>
    </div>
  );
}
