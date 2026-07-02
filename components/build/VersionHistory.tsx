"use client";

import { useEffect, useState, useTransition } from "react";
import { listDocumentVersions, restoreDocumentVersion } from "./materials-actions";
import type { DocumentVersion } from "@/lib/supabase/database.types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function lineDiff(
  oldText: string,
  newText: string,
): { type: "removed" | "added" | "same"; text: string }[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const newSet = new Set(newLines);
  const oldSet = new Set(oldLines);
  const result: { type: "removed" | "added" | "same"; text: string }[] = [];
  for (const line of oldLines) {
    result.push({ type: newSet.has(line) ? "same" : "removed", text: line });
  }
  for (const line of newLines) {
    if (!oldSet.has(line)) result.push({ type: "added", text: line });
  }
  return result;
}

export function VersionHistory({
  docId,
  currentContent,
  onRestore,
}: {
  docId: string;
  currentContent?: string;
  onRestore: (content: string) => void;
}) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [diffWith, setDiffWith] = useState<DocumentVersion | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    listDocumentVersions(docId).then((v) => {
      if (live) { setVersions(v); setLoading(false); }
    });
    return () => { live = false; };
  }, [docId]);

  function restore(version: DocumentVersion) {
    setSelected(version.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("version_id", version.id);
      fd.set("doc_id", docId);
      await restoreDocumentVersion(fd);
      if (version.content != null) onRestore(version.content);
      setSelected(null);
    });
  }

  if (loading) {
    return <p className="text-xs text-fg-muted">Loading history…</p>;
  }

  if (versions.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        No saved versions yet. Each time you save, a snapshot is created here.
      </p>
    );
  }

  return (
    <>
      {diffWith && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <p className="text-sm font-medium text-fg-primary">Diff — {diffWith.name}</p>
              <p className="font-mono text-[10px] text-fg-muted">{relativeTime(diffWith.created_at)} vs current</p>
            </div>
            <button
              type="button"
              onClick={() => setDiffWith(null)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex gap-4 font-mono text-[10px] uppercase tracking-wider text-fg-muted mb-2">
              <span className="text-red-400">− removed</span>
              <span className="text-emerald-400">+ added</span>
              <span>· unchanged</span>
            </div>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed">
              {lineDiff(diffWith.content ?? "", currentContent ?? "").map((line, i) => (
                <span
                  key={i}
                  className={
                    line.type === "removed"
                      ? "block bg-red-500/10 text-red-300"
                      : line.type === "added"
                        ? "block bg-emerald-500/10 text-emerald-300"
                        : "block text-fg-muted"
                  }
                >
                  {line.type === "removed" ? "− " : line.type === "added" ? "+ " : "  "}
                  {line.text}
                </span>
              ))}
            </pre>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {versions.map((v: DocumentVersion, i: number) => (
          <div
            key={v.id}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface-0 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg-primary">{v.name}</p>
              <p className="font-mono text-[10px] text-fg-muted">
                {relativeTime(v.created_at)}
                {i === 0 ? " · Latest" : ""}
                {v.content ? ` · ${v.content.length} chars` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDiffWith(v)}
              className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300"
            >
              Diff
            </button>
            <button
              type="button"
              onClick={() => restore(v)}
              disabled={pending && selected === v.id}
              className="shrink-0 rounded-md border border-line px-3 py-1 text-xs text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300 disabled:opacity-50"
            >
              {pending && selected === v.id ? "Restoring…" : "Restore"}
            </button>
          </div>
        ))}
        <p className="text-[10px] text-fg-muted">Up to 20 versions are kept per document.</p>
      </div>
    </>
  );
}
