"use client";

import { useMemo, useState } from "react";
import { inputClass } from "./DraftWithEarn";
import { getWizardQuestions } from "@/lib/builder-wizard";
import { finalizeWithEarn } from "./builder-actions";

// Guided setup: a short, section-aware questionnaire. The operator answers
// plain questions, then Earn expands the answers into an institutional draft
// (written into the shared draft on the right via onContent).
export function BuilderWizard({
  docId,
  name,
  section,
  onContent,
}: {
  docId: string;
  name: string;
  section: string;
  onContent: (content: string) => void;
}) {
  const questions = useMemo(() => getWizardQuestions(name, section), [name, section]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const total = questions.length;
  const onReview = step >= total;
  const answeredCount = questions.filter((q) => (answers[q.id] ?? "").trim()).length;

  function set(id: string, v: string) {
    setAnswers((a) => ({ ...a, [id]: v }));
  }

  async function finalize() {
    setBusy(true);
    setDone(false);
    const res = await finalizeWithEarn(docId, answers);
    setBusy(false);
    if ("error" in res) return;
    onContent(res.content);
    setDone(true);
  }

  if (onReview) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">Review</span>
          <span className="font-mono text-[10px] text-fg-muted">
            {answeredCount}/{total} answered
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-3">
          {questions.map((q) => (
            <div key={q.id}>
              <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{q.label}</p>
              <p className="text-sm text-fg-secondary">{(answers[q.id] ?? "").trim() || "—"}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStep(total - 1)}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={finalize}
            disabled={busy || answeredCount === 0}
            className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:opacity-60"
          >
            {busy ? "Earn is drafting…" : "✶ Make it institutional with Earn"}
          </button>
        </div>
        {done ? (
          <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-300">
            Earn drafted the document — review it on the right and Save.
          </p>
        ) : (
          <p className="text-xs text-fg-muted">Earn expands your answers into a polished, institutional draft.</p>
        )}
      </div>
    );
  }

  const q = questions[step];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
          Step {step + 1} of {total}
        </span>
        <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-gold-400" style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-fg-primary">{q.label}</span>
        {q.hint ? <span className="text-xs text-fg-muted">{q.hint}</span> : null}
        {q.multiline ? (
          <textarea
            value={answers[q.id] ?? ""}
            onChange={(e) => set(q.id, e.target.value)}
            rows={4}
            className={`${inputClass} resize-y`}
            autoFocus
          />
        ) : (
          <input
            value={answers[q.id] ?? ""}
            onChange={(e) => set(q.id, e.target.value)}
            className={inputClass}
            autoFocus
          />
        )}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => setStep((s) => s + 1)}
          className="rounded-md bg-gold-400 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
        >
          {step === total - 1 ? "Review →" : "Next →"}
        </button>
        <button
          type="button"
          onClick={() => setStep(total)}
          className="ml-auto text-xs text-fg-muted hover:text-gold-300"
        >
          Skip to finish
        </button>
      </div>
    </div>
  );
}
