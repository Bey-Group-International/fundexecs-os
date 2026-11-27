"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AttendeePicker } from "./AttendeePicker";
import type { SelectedAttendee } from "@/lib/meetings/people";
import {
  adviseReminder,
  reminderLabel,
  type ReminderContext,
  type Stakes,
} from "@/lib/meetings/reminder-advice";
import {
  externalCount,
  inviteQuestions,
  recommendedAccess,
  suggestInviteNote,
  type InviteContext,
  type InviteQuestionId,
} from "@/lib/meetings/invite-advice";
import { INVITE_NOTE_MAX } from "@/lib/meetings/invite";

/* ── Shared shell ──────────────────────────────────────────────────────── */

function WizardShell({
  title,
  stepTitles,
  step,
  onClose,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  children,
}: {
  title: string;
  stepTitles: string[];
  step: number;
  onClose: () => void;
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-slate-900/50 sm:items-center sm:p-6">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        // Escape closes the wizard, not the schedule screen underneath it.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="flex h-full w-full max-w-lg flex-col overflow-hidden bg-[var(--surface-1)] shadow-2xl outline-none sm:h-auto sm:max-h-[88vh] sm:rounded-2xl sm:border sm:border-[var(--line)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">{title}</p>
            <p className="truncate text-sm font-medium text-[var(--fg-primary)]">{stepTitles[step]}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="rounded-full p-2 text-[var(--fg-muted)] hover:bg-[var(--surface-0)] hover:text-[var(--fg-primary)]"
          >
            ×
          </button>
        </div>

        <ol className="flex gap-1.5 px-5 pt-3" aria-label="Progress">
          {stepTitles.map((t, i) => (
            <li
              key={t}
              aria-current={i === step ? "step" : undefined}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-[var(--gold-400)]" : "bg-[var(--line)]"}`}
              title={t}
            />
          ))}
        </ol>

        <div className="min-h-[19rem] flex-1 overflow-y-auto px-5 py-4">{children}</div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-5 py-3">
          <button
            type="button"
            onClick={onBack}
            disabled={step === 0}
            className="rounded-full px-4 py-2 text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-0)] disabled:opacity-40"
          >
            Back
          </button>
          <span className="text-[11px] text-[var(--fg-muted)]">
            Step {step + 1} of {stepTitles.length}
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled}
            className="rounded-full bg-[var(--gold-400)] px-5 py-2 text-sm font-semibold text-white hover:bg-[var(--gold-500)] disabled:opacity-50"
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  title,
  hint,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
        active
          ? "border-[var(--gold-400)] bg-gold-400/10"
          : "border-[var(--line)] bg-[var(--surface-0)] hover:border-[var(--fg-muted)]"
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-[var(--fg-primary)]">
        {title}
        {badge ? (
          <span className="rounded-full bg-gold-400/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--gold-400)]">
            {badge}
          </span>
        ) : null}
      </span>
      {hint ? <span className="text-[11px] leading-snug text-[var(--fg-muted)]">{hint}</span> : null}
    </button>
  );
}

function ChipRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
            value === o.value
              ? "border-[var(--gold-400)] bg-gold-400/15 text-[var(--gold-400)]"
              : "border-[var(--line)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Facts({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-xs">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col">
          <dt className="text-[10px] uppercase tracking-wide text-[var(--fg-muted)]">{i.label}</dt>
          <dd className="capitalize text-[var(--fg-primary)]">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const textareaClass =
  "w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--gold-400)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]";

/* ── Reminder wizard ───────────────────────────────────────────────────── */

const REMINDER_STEPS = ["About the meeting", "Timing", "Recommendation"];

export function ReminderWizard({
  context,
  onApply,
  onClose,
}: {
  context: Omit<ReminderContext, "stakes" | "needsPrep">;
  onApply: (minutes: number | null) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [stakes, setStakes] = useState<Stakes | "auto">("auto");
  const [prep, setPrep] = useState<"auto" | "yes" | "no">("auto");
  // undefined = take the recommendation; set once the host picks an alternative.
  const [pick, setPick] = useState<number | null | undefined>(undefined);

  const advice = useMemo(
    () =>
      adviseReminder({
        ...context,
        stakes: stakes === "auto" ? undefined : stakes,
        needsPrep: prep === "auto" ? undefined : prep === "yes",
      }),
    // `context` is rebuilt each render by the caller; its parts are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      context.meetingType,
      context.startIso,
      context.durationMinutes,
      context.timezone,
      context.guestCount,
      context.externalCount,
      context.offHoursGuests,
      context.repeating,
      context.hasPrep,
      stakes,
      prep,
    ],
  );
  const chosen = pick === undefined ? advice.minutes : pick;
  const last = step === REMINDER_STEPS.length - 1;

  return (
    <WizardShell
      title="Reminder setup"
      stepTitles={REMINDER_STEPS}
      step={step}
      onClose={onClose}
      onBack={() => setStep((s) => Math.max(0, s - 1))}
      onNext={() => (last ? onApply(chosen) : setStep((s) => s + 1))}
      nextLabel={last ? `Use ${reminderLabel(chosen).toLowerCase()}` : "Next"}
    >
      {step === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--fg-secondary)]">
            Here is what we can see about this meeting. Correct anything that is off — the recommendation follows your answers.
          </p>
          <Facts items={advice.context} />
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-[var(--fg-primary)]">How much does it matter that everyone shows up?</p>
            <ChipRow
              label="Attendance matters"
              value={stakes}
              onChange={(v) => {
                setStakes(v);
                setPick(undefined);
              }}
              options={[
                { value: "auto", label: "You decide" },
                { value: "routine", label: "Routine" },
                { value: "important", label: "Important" },
                { value: "critical", label: "Critical" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-[var(--fg-primary)]">Do guests need to prepare beforehand?</p>
            <ChipRow
              label="Guests need to prepare"
              value={prep}
              onChange={(v) => {
                setPrep(v);
                setPick(undefined);
              }}
              options={[
                { value: "auto", label: "You decide" },
                { value: "yes", label: "Yes — pre-read or prep" },
                { value: "no", label: "No" },
              ]}
            />
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <Facts items={advice.timing} />
          <ul className="flex flex-col gap-2 text-xs leading-snug text-[var(--fg-secondary)]">
            <li>
              {context.guestCount === 0
                ? "No guests yet — a reminder would only reach your own calendar."
                : `A reminder email goes to ${context.guestCount} ${context.guestCount === 1 ? "guest" : "guests"}${
                    context.externalCount ? `, ${context.externalCount} of them outside your team` : ""
                  }.`}
            </li>
            <li>Reminders are sent once per meeting. Moving the meeting re-arms it.</li>
            {context.offHoursGuests > 0 ? (
              <li>
                {context.offHoursGuests} {context.offHoursGuests === 1 ? "guest has" : "guests have"} this time outside their working hours.
              </li>
            ) : null}
            {advice.cautions.map((c) => (
              <li key={c} className="text-[var(--status-warning)]">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-gold-400/40 bg-gold-400/5 px-4 py-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--gold-400)]">Recommended</p>
            <p className="mt-0.5 text-lg font-semibold text-[var(--fg-primary)]">{reminderLabel(advice.minutes)}</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs leading-snug text-[var(--fg-secondary)]">
              {advice.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          {advice.cautions.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-snug text-[var(--status-warning)]">
              {advice.cautions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
          {advice.alternatives.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-[var(--fg-primary)]">Or choose another</p>
              <div role="radiogroup" aria-label="Reminder" className="flex flex-col gap-1.5">
                <Choice
                  active={pick === undefined || pick === advice.minutes}
                  onClick={() => setPick(undefined)}
                  title={reminderLabel(advice.minutes)}
                  badge="Recommended"
                />
                {advice.alternatives.map((a) => (
                  <Choice
                    key={String(a.minutes)}
                    active={pick === a.minutes}
                    onClick={() => setPick(a.minutes)}
                    title={a.label}
                    hint={a.why}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </WizardShell>
  );
}

/* ── Invitation wizard ─────────────────────────────────────────────────── */

export interface InviteWizardProps {
  ctx: InviteContext;
  attendees: SelectedAttendee[];
  onAttendees: (next: SelectedAttendee[]) => void;
  unreachable: Array<{ name: string }>;
  onRemoveUnreachable: (index: number) => void;
  onQuickAccess: (on: boolean) => void;
  onObjective: (v: string) => void;
  onAgenda: (v: string) => void;
  onPrep: (v: string) => void;
  onNote: (v: string) => void;
  /** Questions the host has already dealt with, kept by the caller across openings. */
  reviewed: ReadonlySet<InviteQuestionId>;
  onReview: (id: InviteQuestionId) => void;
  onClose: () => void;
}

export function InviteWizard(props: InviteWizardProps) {
  const { ctx, reviewed, onReview, onClose } = props;

  // Frozen when the wizard opens: answering a question must not remove it from
  // under the host mid-flow. Anything the host already reviewed is not re-asked.
  const [queue] = useState(() =>
    inviteQuestions(ctx)
      .filter((q) => q.open && !reviewed.has(q.id))
      .map((q) => q.id),
  );
  const [step, setStep] = useState(0);

  const questions = inviteQuestions(ctx);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ids: Array<InviteQuestionId | "review"> = [...queue, "review"];
  const current = ids[step];
  const q = current === "review" ? null : (byId.get(current) ?? null);
  const stepTitles = ids.map((id) => (id === "review" ? "Review" : STEP_TITLES[id]));
  const last = step === ids.length - 1;
  const blocked = Boolean(q?.blocking && q.open);

  function next() {
    if (current !== "review") onReview(current);
    if (last) onClose();
    else setStep((s) => s + 1);
  }

  const outside = externalCount(ctx);

  return (
    <WizardShell
      title="Invitation setup"
      stepTitles={stepTitles}
      step={step}
      onClose={onClose}
      onBack={() => setStep((s) => Math.max(0, s - 1))}
      onNext={next}
      nextLabel={last ? "Done" : "Next"}
      nextDisabled={blocked}
    >
      {q ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--fg-primary)]">{q.prompt}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--fg-muted)]">{q.why}</p>
          </div>

          {current === "guests" ? <AttendeePicker value={props.attendees} onChange={props.onAttendees} label="Add guests" /> : null}

          {current === "unreachable" ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {props.unreachable.map((a, i) => (
                  <span
                    key={`${a.name}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/45 bg-surface-1 py-0.5 pl-2 pr-1.5 text-xs text-fg-secondary"
                  >
                    {a.name}
                    <button
                      type="button"
                      onClick={() => props.onRemoveUnreachable(i)}
                      aria-label={`Remove ${a.name}`}
                      className="shrink-0 rounded-full px-0.5 leading-none text-fg-muted hover:text-[var(--status-danger)]"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <AttendeePicker value={props.attendees} onChange={props.onAttendees} label="Add them by email" />
            </div>
          ) : null}

          {current === "access" ? (
            <div role="radiogroup" aria-label="Guest access" className="flex flex-col gap-1.5">
              <Choice
                active={ctx.guestQuickAccess}
                onClick={() => props.onQuickAccess(true)}
                title="Let them straight in"
                hint="Anyone with the link joins immediately."
                badge={recommendedAccess(ctx.meetingType) === "quick-access" ? "Recommended" : undefined}
              />
              <Choice
                active={!ctx.guestQuickAccess}
                onClick={() => props.onQuickAccess(false)}
                title="I'll let them in"
                hint="Outside guests wait until you admit them. Teammates always skip the wait."
                badge={recommendedAccess(ctx.meetingType) === "waiting-room" ? "Recommended" : undefined}
              />
            </div>
          ) : null}

          {current === "hours" ? (
            <p className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] px-3 py-2 text-xs leading-snug text-[var(--fg-secondary)]">
              Choose <strong>Next</strong> to keep this time — your note will thank them for making it work. To move it,
              close this and change the time; guests&rsquo; local times are shown beside the guest list.
            </p>
          ) : null}

          {current === "prep" ? (
            <textarea
              aria-label="Preparation for guests"
              rows={4}
              value={ctx.preparationRequirements}
              onChange={(e) => props.onPrep(e.target.value)}
              placeholder="e.g. Read the Q3 pack (attached) and bring your questions on the distribution schedule."
              className={textareaClass}
            />
          ) : null}

          {current === "agenda" ? (
            <div className="flex flex-col gap-3">
              <input
                aria-label="Objective"
                value={ctx.objective}
                onChange={(e) => props.onObjective(e.target.value)}
                placeholder="Objective — the outcome this meeting needs to reach"
                className={textareaClass}
              />
              <textarea
                aria-label="Agenda"
                rows={4}
                value={ctx.agenda}
                onChange={(e) => props.onAgenda(e.target.value)}
                placeholder={"One topic per line"}
                className={textareaClass}
              />
            </div>
          ) : null}

          {current === "note" ? (
            <div className="flex flex-col gap-2">
              <textarea
                aria-label="Personal note"
                rows={6}
                maxLength={INVITE_NOTE_MAX}
                value={ctx.note}
                onChange={(e) => props.onNote(e.target.value)}
                placeholder="A line or two to your guests…"
                className={textareaClass}
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => props.onNote(suggestInviteNote(ctx))}
                  className="rounded-full border border-gold-400/50 bg-gold-400/10 px-3 py-1 text-xs font-medium text-[var(--gold-300)] hover:bg-gold-400/20"
                >
                  {ctx.note.trim() ? "Redraft from the meeting" : "Draft one for me"}
                </button>
                <span className="text-[11px] text-[var(--fg-muted)]">
                  {ctx.note.length}/{INVITE_NOTE_MAX}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--fg-secondary)]">
            {ctx.attendees.length === 0
              ? "Nobody is invited yet. Add at least one guest and the invitation goes out when you schedule."
              : `On Schedule, ${ctx.attendees.length} ${ctx.attendees.length === 1 ? "person" : "people"} will be emailed${
                  outside ? ` — ${outside} outside your team` : ""
                }.`}
          </p>
          <Facts
            items={[
              { label: "Guests", value: String(ctx.attendees.length) },
              { label: "Outside guests", value: outside ? (ctx.guestQuickAccess ? "Join straight in" : "Wait to be admitted") : "None" },
              { label: "Preparation", value: ctx.preparationRequirements.trim() ? "Listed" : "None listed" },
              { label: "Agenda", value: ctx.agenda.trim() || ctx.objective.trim() ? "Included" : "None" },
            ]}
          />
          {ctx.noteSupported ? (
            ctx.note.trim() ? (
              <div className="rounded-lg border-l-4 border-[var(--gold-400)] bg-[var(--surface-0)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[var(--fg-muted)]">Your note</p>
                <p className="mt-1 whitespace-pre-line text-xs text-[var(--fg-primary)]">{ctx.note}</p>
              </div>
            ) : (
              <p className="text-xs text-[var(--fg-muted)]">No personal note — guests get the standard invitation.</p>
            )
          ) : (
            <p className="text-xs text-[var(--fg-muted)]">
              This meeting is already out, so guests are told about changes by the standard update email, which carries no note.
            </p>
          )}
        </div>
      )}
    </WizardShell>
  );
}

const STEP_TITLES: Record<InviteQuestionId, string> = {
  guests: "Guests",
  unreachable: "Missing addresses",
  access: "Joining",
  hours: "Local times",
  prep: "Preparation",
  agenda: "Agenda",
  note: "Personal note",
};
