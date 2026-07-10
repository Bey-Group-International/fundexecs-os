"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { answerIdentityQuestion } from "@/app/(app)/build/profile/actions";
import type {
  IdentityQuestionDTO,
  IdentitySectionKey,
} from "@/lib/firm-identity";

type Status = "empty" | "started" | "complete";

interface SectionProgress {
  key: IdentitySectionKey;
  label: string;
  eyebrow: string;
  anchor: string;
  total: number;
  doneCount: number;
  score: number;
  status: Status;
}

interface ProgressProps {
  overall: number;
  status: Status;
  sections: SectionProgress[];
}

// Scroll to a section and briefly flash it, so a "take me there" jump makes the
// target obvious. The sections are server-rendered siblings on the same page;
// we reach them by id (identity | thesis | brand | entity).
function jumpToSection(key: IdentitySectionKey) {
  const el = document.getElementById(key);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("fx-section-flash");
  window.setTimeout(() => el.classList.remove("fx-section-flash"), 1600);
}

function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
      <circle
        cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        className="text-gold-400 transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}

function stageLabel(overall: number): string {
  if (overall >= 100) return "Complete";
  if (overall >= 67) return "Nearly there";
  if (overall >= 34) return "Taking shape";
  if (overall > 0) return "Getting started";
  return "Not started";
}

function SectionChip({ s }: { s: SectionProgress }) {
  const tone =
    s.status === "complete"
      ? "border-emerald-400/40 text-emerald-300"
      : s.status === "started"
        ? "border-gold-500/40 text-gold-300"
        : "border-line text-fg-muted";
  const mark = s.status === "complete" ? "✓" : `${s.doneCount}/${s.total}`;
  return (
    <Link
      href={`/build/profile${s.anchor}`}
      onClick={(e) => {
        e.preventDefault();
        jumpToSection(s.key);
      }}
      title={`${s.label}: ${s.score}% complete`}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:bg-surface-2 ${tone}`}
    >
      <span className="font-mono text-[10px]">{mark}</span>
      <span>{s.label}</span>
    </Link>
  );
}

// The single interview step: renders the current question and the right input
// for its kind. Inline questions (text/textarea/select/color) save one column
// via answerIdentityQuestion; jump questions route to the section to add a row.
function InterviewStep({
  q,
  onAnswered,
  onSkip,
}: {
  q: IdentityQuestionDTO;
  onAnswered: () => void;
  onSkip: () => void;
}) {
  const [value, setValue] = useState(q.kind === "color" ? "#C6A15B" : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    if (!q.field) return;
    setError(null);
    startTransition(async () => {
      const res = await answerIdentityQuestion(q.field as string, value);
      if (res.error) {
        setError(res.error);
        return;
      }
      // Refresh so the section forms + progress ring below reflect the answer.
      router.refresh();
      onAnswered();
    });
  }

  const inputBase =
    "w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary outline-none transition focus:border-gold-500/50";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-medium leading-snug text-fg-primary">{q.question}</p>
      {q.hint ? <p className="-mt-1 text-xs leading-snug text-fg-muted">{q.hint}</p> : null}

      {q.kind === "jump" ? (
        <button
          type="button"
          onClick={() => {
            jumpToSection(q.section);
            onSkip(); // advance past it in the interview; the section handles the edit
          }}
          className="self-start rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20"
        >
          Take me to {q.sectionLabel} →
        </button>
      ) : (
        <>
          {q.kind === "textarea" ? (
            <textarea
              autoFocus
              rows={3}
              value={value}
              placeholder={q.placeholder}
              onChange={(e) => setValue(e.target.value)}
              className={`${inputBase} resize-y`}
            />
          ) : q.kind === "select" ? (
            <select
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputBase}
            >
              <option value="">Select…</option>
              {q.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : q.kind === "color" ? (
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface-1"
              />
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`${inputBase} max-w-[8rem] font-mono`}
              />
            </div>
          ) : (
            <input
              autoFocus
              value={value}
              placeholder={q.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) save();
              }}
              className={inputBase}
            />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !value.trim()}
              className="rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save & continue →"}
            </button>
            <button
              type="button"
              onClick={() => jumpToSection(q.section)}
              className="text-xs text-fg-muted transition hover:text-gold-300"
            >
              or edit in the {q.sectionLabel} section ↓
            </button>
          </div>
          {error ? <p className="text-xs text-status-danger">{error}</p> : null}
        </>
      )}
    </div>
  );
}

/**
 * The interactive Firm Identity control surface: a readiness header (overall
 * ring, per-section chips, next-step nudge) plus a guided "Complete with Earn"
 * interview that walks the operator through unanswered questions one at a time.
 */
export function FirmIdentityGuide({
  firmName,
  progress,
  questions,
}: {
  firmName: string;
  progress: ProgressProps;
  questions: IdentityQuestionDTO[];
}) {
  // Snapshot the pending queue once so the stepper stays stable across the
  // router.refresh() that each inline answer triggers. `progress` (from props)
  // still updates live, so the ring and chips climb as answers land.
  const [queue] = useState(questions);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const total = queue.length;
  const atEnd = step >= total;
  const q = atEnd ? null : queue[step];
  const complete = progress.status === "complete";

  const next = () => setStep((s) => Math.min(total, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="mb-8 rounded-2xl border border-line bg-surface-1 p-5">
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <Ring value={progress.overall} />
          <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-semibold text-fg-primary">
            {progress.overall}%
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Firm Identity
            </span>
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              {stageLabel(progress.overall)}
            </span>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            {complete ? (
              <>
                <span className="font-medium text-fg-primary">{firmName || "Your firm"}</span> is
                fully briefed — Earn has everything it needs to represent you.
              </>
            ) : (
              <>
                The one profile every counterparty and every Earn output reads. Answer a few
                questions and watch it complete.
              </>
            )}
          </p>

          {/* Per-section progress */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {progress.sections.map((s) => (
              <SectionChip key={s.key} s={s} />
            ))}
          </div>
        </div>
      </div>

      {/* CTA / next-step nudge */}
      {complete ? (
        <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">
          ✓ Firm identity complete — you&apos;re fundraising-ready.
        </div>
      ) : !open ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20"
          >
            ✶ Complete with a guided interview
          </button>
          {queue[0] ? (
            <span className="text-xs text-fg-muted">
              Next: <span className="text-fg-secondary">{queue[0].question}</span>
            </span>
          ) : null}
        </div>
      ) : (
        // Interview panel
        <div className="mt-4 rounded-xl border border-gold-500/25 bg-gold-500/[0.04] p-4">
          {atEnd ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg-primary">
                That&apos;s everything queued. Your answers are saved and the sections below reflect
                them.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep(0);
                    setOpen(false);
                  }}
                  className="rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20"
                >
                  Done
                </button>
                {step > 0 ? (
                  <button
                    type="button"
                    onClick={back}
                    className="text-xs text-fg-muted transition hover:text-fg-primary"
                  >
                    ← Back
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gold-400">
                  {q!.sectionLabel} · Step {step + 1} of {total}
                </span>
                <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-gold-400 transition-all"
                    style={{ width: `${((step + 1) / total) * 100}%` }}
                  />
                </div>
              </div>

              {/* key forces a fresh InterviewStep (and its local input) per step */}
              <InterviewStep key={q!.id} q={q!} onAnswered={next} onSkip={next} />

              <div className="flex items-center gap-3 border-t border-gold-500/15 pt-3">
                <button
                  type="button"
                  onClick={back}
                  disabled={step === 0}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:text-fg-primary disabled:opacity-40"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="text-xs text-fg-muted transition hover:text-gold-300"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-auto text-xs text-fg-muted transition hover:text-fg-primary"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
