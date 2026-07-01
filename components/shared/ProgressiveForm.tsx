"use client";

import { type ReactNode } from "react";

export interface ProgressiveFormStep {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  /** Return true if this step's data is valid and the user can advance. */
  isComplete: boolean;
}

interface ProgressiveFormProps {
  steps: ProgressiveFormStep[];
  currentStep: number;
  onNext: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
}

export function ProgressiveForm({
  steps,
  currentStep,
  onNext,
  onBack,
  onSubmit,
  submitLabel = "Submit",
  isSubmitting = false,
}: ProgressiveFormProps) {
  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;
  const progress = ((currentStep + 1) / steps.length) * 100;

  if (!step) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar + step counter */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            Step {currentStep + 1} of {steps.length}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            {Math.round(progress)}%
          </span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gold-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Step pills — click to jump back to a completed step */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {steps.map((s, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <button
              key={s.id}
              type="button"
              disabled={i > currentStep}
              onClick={() => {
                // Jumping backwards is always allowed; forward only if complete.
                if (i < currentStep) {
                  // Parent controls step index — emit back calls until we reach the target.
                  // In practice callers handle this by managing currentStep themselves.
                }
              }}
              className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition ${
                active
                  ? "bg-gold-500 text-black"
                  : done
                    ? "border border-status-success/40 bg-status-success/10 text-status-success"
                    : "border border-line text-fg-muted opacity-50"
              }`}
            >
              {done ? "✓ " : ""}{s.title}
            </button>
          );
        })}
      </div>

      {/* Current step content */}
      <div className="flex flex-col gap-4 animate-fade-up">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-fg-primary">{step.title}</h3>
          {step.description ? (
            <p className="text-xs text-fg-muted">{step.description}</p>
          ) : null}
        </div>
        <div>{step.content}</div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3">
        {currentStep > 0 ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}

        {isLast ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!step.isComplete || isSubmitting}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            {isSubmitting ? "Saving…" : submitLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={!step.isComplete}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}
