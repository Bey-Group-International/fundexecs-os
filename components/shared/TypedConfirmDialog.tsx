"use client";

import { useEffect, useState } from "react";

// A confirmation harder to blow past than window.confirm()'s single dismissible
// dialog — for actions whose blast radius goes well beyond what the button
// label suggests (e.g. "Clear all deals" also cascades to every document,
// underwriting, and diligence item tied to those deals). The operator must
// type the exact phrase before the confirm button enables. Escape/backdrop
// click cancel, matching the overlay conventions used elsewhere
// (ArtifactModal, StripeCheckoutModal): Escape-to-close + body-scroll-lock.
export function TypedConfirmDialog({
  open,
  title,
  body,
  phrase,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  phrase: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setValue("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onCancel]);

  if (!open) return null;

  const matches = value === phrase;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-status-danger/40 bg-surface-1 p-5 shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-fg-primary">{title}</h2>
        <p className="mt-1.5 text-xs text-fg-secondary">{body}</p>
        <p className="mt-3 text-xs text-fg-muted">
          Type <span className="font-mono font-semibold text-status-danger">{phrase}</span> to confirm.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches) onConfirm();
          }}
          className="mt-2 w-full rounded-md border border-line bg-surface-0 px-2.5 py-1.5 text-sm text-fg-primary outline-none focus:border-status-danger/60"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches}
            onClick={onConfirm}
            className="rounded-md bg-status-danger/90 px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:bg-status-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
