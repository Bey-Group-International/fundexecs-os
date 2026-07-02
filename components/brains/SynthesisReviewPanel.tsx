"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SynthesisItem, SynthesisStatus } from "@/lib/brains/synthesis";
import { EmptyState } from "@/components/shared";

interface Props {
  orgId: string;
}

// --- helpers -----------------------------------------------------------------

function formatTopicKey(key: string): string {
  // "deal:abc123" -> "Deal: abc123"
  const colon = key.indexOf(":");
  if (colon === -1) return key;
  const prefix = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  return `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}: ${rest}`;
}

const STATUS_STYLES: Record<SynthesisStatus, string> = {
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  processing:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  approved:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  discarded: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

// --- Toast -------------------------------------------------------------------

interface ToastProps {
  message: string;
  onDone: () => void;
}

function Toast({ message, onDone }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-line bg-surface-1 px-4 py-3 shadow-lg">
      <svg
        className="h-5 w-5 shrink-0 text-green-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
      <span className="text-sm text-fg-primary">{message}</span>
    </div>
  );
}

// --- SynthesisCard -----------------------------------------------------------

interface CardProps {
  item: SynthesisItem;
  onApprove: (id: string, editedContent: string | null) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
}

function SynthesisCard({ item, onApprove, onDiscard }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleEdit = () => {
    setEditing(true);
    // Focus the editable div after state update
    setTimeout(() => contentRef.current?.focus(), 0);
  };

  const handleApprove = async () => {
    setBusy(true);
    const edited = editing
      ? (contentRef.current?.innerText ?? null)
      : null;
    await onApprove(item.id, edited);
    setBusy(false);
  };

  const handleDiscard = async () => {
    setBusy(true);
    await onDiscard(item.id);
    setBusy(false);
  };

  return (
    <article className="rounded-xl border border-line bg-surface-1 p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-fg-primary">
            {formatTopicKey(item.topic_key)}
          </h3>
          {/* Source count badge */}
          <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-fg-secondary">
            {(item.source_artifact_ids as string[])?.length ?? 0}{" "}
            {((item.source_artifact_ids as string[])?.length ?? 0) === 1 ? "source" : "sources"}
          </span>
        </div>
        {/* Status chip */}
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[item.synthesis_status]}`}
        >
          {item.synthesis_status}
        </span>
      </div>

      {/* Split view — only when draft_content exists */}
      {item.draft_content && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: artifact IDs */}
          <div className="rounded-lg border border-line bg-surface-2 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
              Source Artifacts
            </p>
            <ul className="space-y-1">
              {((item.source_artifact_ids as string[]) ?? []).map((aid) => (
                <li
                  key={aid}
                  className="truncate font-mono text-xs text-fg-secondary"
                >
                  {aid}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: draft content (editable when editing=true) */}
          <div className="rounded-lg border border-line bg-surface-2 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
              Draft Content
            </p>
            <div
              ref={contentRef}
              contentEditable={editing}
              suppressContentEditableWarning
              className={`min-h-[6rem] whitespace-pre-wrap text-sm text-fg-primary outline-none ${
                editing
                  ? "rounded border border-blue-400 bg-white p-2 dark:bg-surface-1"
                  : ""
              }`}
            >
              {item.draft_content}
            </div>
          </div>
        </div>
      )}

      {/* If no draft_content, show artifact list inline */}
      {!item.draft_content && (((item.source_artifact_ids as string[])?.length ?? 0) > 0) && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
            Source Artifacts
          </p>
          <div className="flex flex-wrap gap-2">
            {((item.source_artifact_ids as string[]) ?? []).map((aid) => (
              <span
                key={aid}
                className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-secondary"
              >
                {aid}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          onClick={handleApprove}
          disabled={busy}
          className="inline-flex items-center rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={handleDiscard}
          disabled={busy}
          className="inline-flex items-center rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-primary hover:bg-surface-3 disabled:opacity-50"
        >
          Discard
        </button>
        {item.draft_content && !editing && (
          <button
            onClick={handleEdit}
            disabled={busy}
            className="inline-flex items-center rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-primary hover:bg-surface-3 disabled:opacity-50"
          >
            Edit
          </button>
        )}
        {editing && (
          <span className="text-xs text-fg-tertiary">
            Editing — click Approve to save changes
          </span>
        )}
      </div>
    </article>
  );
}

// --- Main panel --------------------------------------------------------------

export function SynthesisReviewPanel({ orgId }: Props) {
  const [items, setItems] = useState<SynthesisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/brains/synthesis?orgId=${encodeURIComponent(orgId)}`);
      if (!res.ok) throw new Error(await res.text());
      const data: SynthesisItem[] = await res.json();
      setItems(data);
    } catch (err) {
      console.error("SynthesisReviewPanel fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleApprove = async (id: string, editedContent: string | null) => {
    const body: Record<string, unknown> = {};
    if (editedContent !== null) body.draft_content = editedContent;

    const res = await fetch(`/api/brains/synthesis/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setToast("Knowledge article published to Brain");
    }
  };

  const handleDiscard = async (id: string) => {
    const res = await fetch(`/api/brains/synthesis/${id}/discard`, {
      method: "POST",
    });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
        Loading syntheses...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState
          title="No pending syntheses"
          description="Synthesis items will appear here when the Brain processes new artifacts."
        />
      ) : (
        items.map((item) => (
          <SynthesisCard
            key={item.id}
            item={item}
            onApprove={handleApprove}
            onDiscard={handleDiscard}
          />
        ))
      )}

      {toast && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
