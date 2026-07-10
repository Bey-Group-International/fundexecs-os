"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

const SECTION_ORDER: IdentitySectionKey[] = ["identity", "thesis", "brand", "entity"];

// Scroll to a section and briefly flash it. Sections are server-rendered
// siblings reached by id (identity | thesis | brand | entity).
function jumpToSection(key: IdentitySectionKey) {
  const el = document.getElementById(key);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("fx-section-flash");
  window.setTimeout(() => el.classList.remove("fx-section-flash"), 1600);
}

function Ring({ value, size = 72 }: { value: number; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-line" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="5"
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

function StatusMark({ s }: { s: SectionProgress }) {
  if (s.status === "complete")
    return <span className="font-mono text-[10px] text-emerald-400">✓</span>;
  return (
    <span className="font-mono text-[10px] text-fg-muted">
      {s.doneCount}/{s.total}
    </span>
  );
}

// ── Guided interview ─────────────────────────────────────────────────────────

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
            onSkip();
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
            <select autoFocus value={value} onChange={(e) => setValue(e.target.value)} className={inputBase}>
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
              or edit in {q.sectionLabel} ↓
            </button>
          </div>
          {error ? <p className="text-xs text-status-danger">{error}</p> : null}
        </>
      )}
    </div>
  );
}

function InterviewModal({
  questions,
  onClose,
}: {
  questions: IdentityQuestionDTO[];
  onClose: () => void;
}) {
  // Snapshot the queue at open so the stepper is stable across router.refresh().
  const [queue] = useState(questions);
  const [step, setStep] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = queue.length;
  const atEnd = step >= total;
  const q = atEnd ? null : queue[step];

  const next = () => setStep((s) => Math.min(total, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fx-scrim-enter absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Firm identity guided interview"
        className="fx-sheet-enter relative w-full max-w-lg overflow-hidden rounded-2xl border border-gold-500/25 bg-surface-1 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            Guided interview
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-0.5 text-fg-muted transition hover:text-fg-primary"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {atEnd ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg-primary">
                That&apos;s everything queued. Your answers are saved and the sections reflect them.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
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
                  <div className="h-full bg-gold-400 transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
                </div>
              </div>

              <InterviewStep key={q!.id} q={q!} onAnswered={next} onSkip={next} />

              <div className="flex items-center gap-3 border-t border-line pt-3">
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
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sticky rail ──────────────────────────────────────────────────────────────

/**
 * The institutional left rail for the Firm Identity page: a completion ring, a
 * scroll-aware section navigator (Identity · Thesis · Brand · Entity), and the
 * launcher for the guided interview that walks the operator through what's still
 * missing. Sticks alongside the editable content like a data-room contents pane.
 */
export function FirmIdentityRail({
  firmName,
  progress,
  questions,
}: {
  firmName: string;
  progress: ProgressProps;
  questions: IdentityQuestionDTO[];
}) {
  const [active, setActive] = useState<IdentitySectionKey>("identity");
  const [interviewOpen, setInterviewOpen] = useState(false);

  // Scrollspy: highlight the section currently near the top of the viewport.
  useEffect(() => {
    const els = SECTION_ORDER.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => !!el,
    );
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id as IdentitySectionKey);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const complete = progress.status === "complete";
  const byKey = new Map(progress.sections.map((s) => [s.key, s]));

  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <div className="rounded-2xl border border-line bg-surface-1 p-5">
        {/* Completion ring */}
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <Ring value={progress.overall} />
            <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-semibold text-fg-primary">
              {progress.overall}%
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Firm Identity
            </p>
            <p className="mt-0.5 truncate font-display text-base font-semibold text-fg-primary">
              {firmName || "Your firm"}
            </p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {stageLabel(progress.overall)}
            </p>
          </div>
        </div>

        {/* Section navigator (contents pane) */}
        <nav className="mt-5 flex flex-col gap-0.5">
          {SECTION_ORDER.map((key, i) => {
            const s = byKey.get(key);
            if (!s) return null;
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => jumpToSection(key)}
                aria-current={isActive ? "true" : undefined}
                className={`group flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-left text-sm transition ${
                  isActive
                    ? "border-gold-400 bg-gold-500/[0.06] text-fg-primary"
                    : "border-transparent text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                }`}
              >
                <span
                  className={`font-mono text-[10px] ${
                    isActive ? "text-gold-300" : "text-fg-muted"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 truncate">{s.label}</span>
                <StatusMark s={s} />
              </button>
            );
          })}
        </nav>

        {/* Overall progress bar */}
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-gold-400 transition-all duration-500"
            style={{ width: `${progress.overall}%` }}
          />
        </div>

        {/* Interview launcher / completion state */}
        {complete ? (
          <div className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2.5 text-xs text-emerald-300">
            ✓ Identity complete — you&apos;re fundraising-ready.
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setInterviewOpen(true)}
              className="w-full rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-2.5 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20"
            >
              ✶ Complete with guided interview
            </button>
            {questions[0] ? (
              <p className="px-1 text-[11px] leading-snug text-fg-muted">
                Next: <span className="text-fg-secondary">{questions[0].question}</span>
              </p>
            ) : null}
          </div>
        )}
      </div>

      {interviewOpen ? (
        <InterviewModal questions={questions} onClose={() => setInterviewOpen(false)} />
      ) : null}
    </aside>
  );
}
