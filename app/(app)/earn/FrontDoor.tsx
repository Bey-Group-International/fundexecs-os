"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { QUESTIONS, PATHS, pathFromAnswers, type PathKey } from "@/lib/brains/frontdoor";
import { classifyVisitor } from "./actions";

// The five-question qualifying flow. Q1 sets the path; the rest refine Earnest's
// lead summary. On completion it routes to the path and shows Earnest's note +
// next-action CTAs.
export function FrontDoor() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [path, setPath] = useState<PathKey | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(qid: string, value: string) {
    const next = { ...answers, [qid]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    // Last answer — route + ask Earnest for a welcome note.
    const routed = pathFromAnswers(next);
    setPath(routed);
    startTransition(async () => {
      const res = await classifyVisitor(next);
      if (res.ok && res.note) setNote(res.note);
    });
  }

  function reset() {
    setStep(0);
    setAnswers({});
    setPath(null);
    setNote(null);
  }

  if (path) {
    const p = PATHS[path];
    return (
      <div className="rounded-2xl border border-line bg-surface-1 p-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-gold-400">Routed</p>
        <h2 className="mt-1 font-display text-xl font-semibold text-fg-primary">{p.label}</h2>
        <p className="mt-1 text-sm text-fg-secondary">{p.blurb}</p>

        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
            Earnest Fundmaker
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg-primary">
            {pending && !note ? "Earnest is reading the room…" : note}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {p.actions.map((a) => (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
            >
              {a.label} →
            </Link>
          ))}
          <button
            onClick={reset}
            className="rounded-md border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2"
          >
            Start over
          </button>
        </div>
      </div>
    );
  }

  const q = QUESTIONS[step];
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-6">
      <div className="mb-4 flex items-center gap-2">
        {QUESTIONS.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition ${
              i <= step ? "bg-gold-400" : "bg-line"
            }`}
          />
        ))}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-fg-muted">
        Question {step + 1} of {QUESTIONS.length}
      </p>
      <h2 className="mt-1.5 font-display text-xl font-semibold text-fg-primary">{q.prompt}</h2>
      <div className="mt-4 flex flex-col gap-2">
        {q.options.map((o) => (
          <button
            key={o.value}
            onClick={() => choose(q.id, o.value)}
            className="rounded-xl border border-line bg-surface-0 px-4 py-3 text-left text-sm text-fg-primary transition hover:border-gold-500/50 hover:bg-surface-2"
          >
            {o.label}
          </button>
        ))}
      </div>
      {step > 0 ? (
        <button
          onClick={() => setStep(step - 1)}
          className="mt-4 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
        >
          ← Back
        </button>
      ) : null}
    </div>
  );
}
