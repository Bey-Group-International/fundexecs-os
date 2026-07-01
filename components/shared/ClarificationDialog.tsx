"use client";

import { useEffect, useState } from "react";

interface ClarificationDialogProps {
  /** Questions surfaced by generateClarifyingQuestions(). */
  questions: string[];
  /** Called with collected answers when the user confirms. */
  onConfirm: (answers: Record<string, string>) => void;
  /** Called when the user skips clarification entirely. */
  onSkip: () => void;
  /** Workflow or step title shown at the top of the dialog. */
  title: string;
}

/**
 * UX-07 — Mid-run clarification dialog.
 *
 * Renders 0–3 clarifying questions before a workflow starts so the agent
 * has richer context.  The questions are supplied by the caller (typically
 * generated via `generateClarifyingQuestions()` in lib/claude.ts before the
 * workflow engine fires).
 *
 * Esc key → skip.  Answers are optional; empty inputs are omitted from the
 * returned map so the caller can detect unanswered questions.
 */
export function ClarificationDialog({
  questions,
  onConfirm,
  onSkip,
  title,
}: ClarificationDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q, ""])),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onSkip]);

  if (questions.length === 0) return null;

  function handleConfirm() {
    // Strip empty answers so the caller can detect which were answered.
    const filled = Object.fromEntries(
      Object.entries(answers).filter(([, v]) => v.trim().length > 0),
    );
    onConfirm(filled);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clarification needed"
      onClick={onSkip}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-line bg-surface-1 p-5 shadow-2xl animate-fade-up"
      >
        {/* Header */}
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
            ✦ Quick Clarification
          </span>
          <h2 className="text-sm font-medium text-fg-primary">{title}</h2>
          <p className="text-xs text-fg-muted">
            Answer any of these to give your agents better context. All optional — skip to run now.
          </p>
        </div>

        {/* Questions */}
        <div className="flex flex-col gap-3">
          {questions.map((q) => (
            <div key={q} className="flex flex-col gap-1">
              <label className="text-xs text-fg-secondary">{q}</label>
              <input
                type="text"
                value={answers[q] ?? ""}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [q]: e.target.value }))
                }
                placeholder="Optional — leave blank to skip"
                className="w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-400"
              />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-fg-muted transition hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            Skip — run now
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            Confirm & run →
          </button>
        </div>
      </div>
    </div>
  );
}
