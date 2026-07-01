"use client";

import { useEffect, useRef, useState } from "react";

interface InlineEditProps {
  /** Current displayed value. */
  value: string;
  /** Called with the new value when the user commits. Not called if unchanged. */
  onSave: (value: string) => Promise<void> | void;
  /** Placeholder shown when value is empty. */
  placeholder?: string;
  /** Extra Tailwind classes applied to the display text. */
  className?: string;
  /** If true, render a textarea instead of a single-line input. */
  multiline?: boolean;
  /** aria-label for the edit button (defaults to "Edit"). */
  editLabel?: string;
}

/**
 * UX-05 — One-click inline edit.
 *
 * Displays a value as plain text with a hover-revealed edit icon.  Clicking
 * enters edit mode; Enter (single-line) or ⌘↵ (multiline) commits;
 * Escape cancels without saving.
 *
 * Saves only when the trimmed value has changed, so callers don't need to
 * guard against no-op server calls.
 */
export function InlineEdit({
  value,
  onSave,
  placeholder = "Click to edit…",
  className = "",
  multiline = false,
  editLabel = "Edit",
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // Keep draft in sync if the parent value changes externally.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    const shared = {
      ref: inputRef,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      disabled: saving,
      className:
        "w-full rounded border border-gold-400 bg-surface-0 px-2 py-1 text-sm text-fg-primary outline-none disabled:opacity-50",
    } as const;

    return multiline ? (
      <textarea
        {...shared}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        }}
        className={`${shared.className} resize-none`}
      />
    ) : (
      <input
        {...shared}
        type="text"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
          if (e.key === "Enter") { e.preventDefault(); commit(); }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true); }}
      aria-label={editLabel}
      title="Click to edit"
      className={`group flex items-start gap-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${className}`}
    >
      <span className={value ? "text-fg-primary" : "text-fg-muted"}>
        {value || placeholder}
      </span>
      <span
        aria-hidden
        className="shrink-0 mt-0.5 font-mono text-[10px] text-fg-muted opacity-0 transition-opacity group-hover:opacity-100"
      >
        ✎
      </span>
    </button>
  );
}
