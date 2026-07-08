"use client";

// The right-hand canvas: the fund deck the builder assembles, section by
// section. Sections arrive from the scripted chat flow. When Auto-Accept is
// off, the newest section lands as a "proposed" edit with Accept / Reject
// controls — the review affordance from the source page, in fx tokens.
import { useEffect, useRef, useState } from "react";
import type { AppliedSection, DeckSection, PendingSection } from "./types";
import { CircleCheckIcon, PencilIcon, SparklesIcon, XIcon } from "./icons";

export type { AppliedSection, PendingSection } from "./types";

function Field({
  label,
  value,
  figure,
  onCommit,
}: {
  label: string;
  value: string;
  figure?: boolean;
  /** When provided, the value becomes inline-editable. Absent → read-only. */
  onCommit?: (value: string) => void;
}) {
  const editable = typeof onCommit === "function";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed the draft from the latest value whenever we enter edit mode, and focus.
  useEffect(() => {
    if (editing) {
      setDraft(value);
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
    // We intentionally only re-run when `editing` toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const valueClass = figure
    ? "font-display text-2xl font-semibold text-gold-300"
    : "text-sm text-fg-secondary";

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next !== value) onCommit?.(next);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
        {label}
      </span>
      {editable && editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className={[
            valueClass,
            "w-full rounded-md border border-neural-400/60 bg-surface-2 px-1.5 py-0.5",
            "outline-none ring-1 ring-neural-400/30",
          ].join(" ")}
        />
      ) : editable ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Click to edit"
          className={[
            valueClass,
            "group inline-flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-left",
            "-mx-1.5 transition-colors hover:border-neural-400/50 hover:bg-surface-2/60",
          ].join(" ")}
        >
          <span>{value}</span>
          <PencilIcon className="h-3 w-3 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ) : (
        <span className={valueClass}>{value}</span>
      )}
    </div>
  );
}

function SectionCard({
  section,
  index,
  pending,
  onAccept,
  onReject,
  onEditField,
}: {
  section: DeckSection;
  index: number;
  pending?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  /** Present + not pending → applied-section fields are editable. */
  onEditField?: (fieldIndex: number, value: string) => void;
}) {
  return (
    <article
      className={[
        "animate-fade-up rounded-xl border bg-surface-1 p-5",
        pending
          ? "border-gold-400/60 ring-1 ring-gold-400/30"
          : "border-line",
      ].join(" ")}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-3 font-mono text-xs text-neural-300">
            {index + 1}
          </span>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
              {section.kicker}
            </div>
            <h3 className="font-display text-base font-semibold text-fg-primary">
              {section.title}
            </h3>
          </div>
        </div>
        {pending ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-gold-400/50 bg-gold-400/10 px-2 py-0.5 text-[10px] font-medium text-gold-300">
            <SparklesIcon className="h-3 w-3" />
            Proposed edit
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-status-success">
            <CircleCheckIcon className="h-3.5 w-3.5" />
            Applied
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {section.fields.map((f, i) => (
          <Field
            key={f.label}
            label={f.label}
            value={f.value}
            figure={f.figure}
            onCommit={
              onEditField && !pending
                ? (value) => onEditField(i, value)
                : undefined
            }
          />
        ))}
      </div>

      {pending ? (
        <footer className="mt-5 flex items-center justify-end gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-2"
          >
            <XIcon className="h-3.5 w-3.5" />
            Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-surface-0 transition-colors hover:bg-gold-300"
          >
            <CircleCheckIcon className="h-3.5 w-3.5" />
            Accept edit
          </button>
        </footer>
      ) : null}
    </article>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface-1 text-neural-300">
        <PencilIcon className="h-6 w-6" />
      </div>
      <h2 className="font-display text-xl font-semibold text-fg-primary">
        Your deck builds here
      </h2>
      <p className="mt-2 max-w-sm text-sm text-fg-muted">
        Describe your fund in the chat, or tap a suggestion. Each reply drafts a
        new section of an investor-ready deck on this canvas.
      </p>
    </div>
  );
}

export function BuilderCanvas({
  applied,
  pending,
  onAccept,
  onReject,
  onEditField,
}: {
  applied: AppliedSection[];
  pending: PendingSection | null;
  onAccept: () => void;
  onReject: () => void;
  /** Optional. When provided, applied-section field values become inline-
   *  editable; committing calls onEditField(sectionKey, fieldIndex, value).
   *  Omit to keep the canvas fully read-only (backward compatible). */
  onEditField?: (sectionKey: number, fieldIndex: number, value: string) => void;
}) {
  const isEmpty = applied.length === 0 && !pending;

  return (
    <div className="flex h-full flex-col">
      {/* Canvas toolbar */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            Canvas
          </span>
          <span className="text-fg-muted">/</span>
          <span className="text-sm font-medium text-fg-primary">Fund Deck</span>
        </div>
        <span className="rounded-full border border-line bg-surface-1 px-2.5 py-1 font-mono text-[10px] text-fg-muted">
          {applied.length}/6 sections
        </span>
      </div>

      {/* Scroll surface */}
      <div className="flex-1 overflow-y-auto p-5">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {applied.map((s, i) => (
              <SectionCard
                key={s.key}
                section={s.section}
                index={i}
                onEditField={
                  onEditField
                    ? (fieldIndex, value) => onEditField(s.key, fieldIndex, value)
                    : undefined
                }
              />
            ))}
            {pending ? (
              <SectionCard
                key={pending.key}
                section={pending.section}
                index={applied.length}
                pending
                onAccept={onAccept}
                onReject={onReject}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
