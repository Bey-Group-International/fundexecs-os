"use client";

import { useState } from "react";
import {
  INTAKE_LABEL_MAX,
  INTAKE_MAX_OPTIONS,
  INTAKE_MAX_QUESTIONS,
  intakeIdFor,
  normalizeIntakeQuestions,
  type IntakeKind,
  type IntakeQuestion,
} from "@/lib/meetings/intake";

/** A question as it is being edited: options held as the text the host typed. */
interface Draft {
  id: string;
  label: string;
  kind: IntakeKind;
  optionsText: string;
  required: boolean;
}

const KIND_LABEL: Record<IntakeKind, string> = {
  short: "Short answer",
  long: "Paragraph",
  choice: "Pick one",
};

/** Starting points a fund team reaches for, one tap each. */
const SUGGESTIONS: Array<Omit<IntakeQuestion, "id">> = [
  { label: "Company or fund", kind: "short", options: [], required: true },
  { label: "What would you like to cover?", kind: "long", options: [], required: false },
  { label: "Which best describes you?", kind: "choice", options: ["LP", "GP", "Founder", "Advisor", "Other"], required: false },
];

function toDraft(q: IntakeQuestion): Draft {
  return { id: q.id, label: q.label, kind: q.kind, optionsText: q.options.join(", "), required: q.required };
}

/** What will be saved: the drafts, read back through the same rules the server applies. */
export function draftsToQuestions(drafts: readonly Draft[]): IntakeQuestion[] {
  return normalizeIntakeQuestions(
    drafts.map((d) => ({
      id: d.id,
      label: d.label,
      kind: d.kind,
      options: d.optionsText.split(",").map((o) => o.trim()),
      required: d.required,
    })),
  );
}

/**
 * The questions one meeting type asks the person booking it.
 *
 * Saved explicitly, like the rest of the scheduling settings: a half-typed
 * question going live on a public page as somebody books would be worse than
 * a button press.
 */
export function IntakeQuestionsEditor({
  questions,
  busy,
  onSave,
  onClose,
}: {
  questions: IntakeQuestion[];
  busy: boolean;
  onSave: (questions: IntakeQuestion[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(toDraft));
  const [saved, setSaved] = useState(false);

  function update(index: number, patch: Partial<Draft>) {
    setSaved(false);
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function add(seed?: Omit<IntakeQuestion, "id">) {
    setSaved(false);
    setDrafts((prev) => {
      if (prev.length >= INTAKE_MAX_QUESTIONS) return prev;
      const id = intakeIdFor(seed?.label ?? "question", new Set(prev.map((d) => d.id)));
      return [
        ...prev,
        seed ? toDraft({ ...seed, id }) : { id, label: "", kind: "short", optionsText: "", required: false },
      ];
    });
  }

  function move(index: number, by: -1 | 1) {
    setSaved(false);
    setDrafts((prev) => {
      const next = [...prev];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  async function save() {
    const ok = await onSave(draftsToQuestions(drafts));
    if (ok) {
      setSaved(true);
      setDrafts(draftsToQuestions(drafts).map(toDraft));
    }
  }

  const unused = SUGGESTIONS.filter((s) => !drafts.some((d) => d.label.trim().toLowerCase() === s.label.toLowerCase()));

  return (
    <div className="flex w-full flex-col gap-3 border-t border-[var(--line)] pt-3">
      <p className="text-xs text-[var(--fg-muted)]">
        Asked on the booking page. Answers go into the meeting&rsquo;s description, your confirmation email and the AI
        meeting notes. Up to {INTAKE_MAX_QUESTIONS}.
      </p>

      {drafts.length === 0 ? <p className="text-xs text-[var(--fg-secondary)]">No questions yet.</p> : null}

      <ol className="flex flex-col gap-2">
        {drafts.map((d, i) => (
          <li key={d.id} className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={d.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Question"
                aria-label={`Question ${i + 1}`}
                maxLength={INTAKE_LABEL_MAX}
                className="min-w-[10rem] flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-sm text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
              />
              <select
                value={d.kind}
                aria-label={`Answer type for question ${i + 1}`}
                onChange={(e) => update(i, { kind: e.target.value as IntakeKind })}
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1.5 text-xs text-[var(--fg-primary)]"
              >
                {(Object.keys(KIND_LABEL) as IntakeKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            {d.kind === "choice" ? (
              <input
                type="text"
                value={d.optionsText}
                onChange={(e) => update(i, { optionsText: e.target.value })}
                placeholder={`Choices, separated by commas (2–${INTAKE_MAX_OPTIONS})`}
                aria-label={`Choices for question ${i + 1}`}
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--fg-secondary)]">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={d.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                  className="h-4 w-4 accent-[var(--gold-400)]"
                />
                Required
              </label>
              <span className="ml-auto flex items-center gap-1">
                <IconButton label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </IconButton>
                <IconButton label={`Move question ${i + 1} down`} disabled={i === drafts.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </IconButton>
                <IconButton
                  label={`Remove question ${i + 1}`}
                  onClick={() => {
                    setSaved(false);
                    setDrafts((prev) => prev.filter((_, j) => j !== i));
                  }}
                >
                  ✕
                </IconButton>
              </span>
            </div>
          </li>
        ))}
      </ol>

      {drafts.length < INTAKE_MAX_QUESTIONS ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => add()}
            className="rounded-lg border border-dashed border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
          >
            + Add question
          </button>
          {unused.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--fg-muted)] hover:border-[var(--gold-400)] hover:text-[var(--fg-primary)]"
            >
              + {s.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--gold-500)] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save questions"}
        </button>
        <button type="button" onClick={onClose} className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]">
          Close
        </button>
        {saved ? <span className="text-xs text-[var(--gold-400)]">Saved.</span> : null}
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--surface-0)] hover:text-[var(--fg-primary)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}
