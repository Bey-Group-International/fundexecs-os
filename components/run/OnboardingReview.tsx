"use client";

// components/run/OnboardingReview.tsx
// Run › Onboarding: one card per LP. Expand it to record each screening check,
// see what is standing in the way of an approval, record your decision with its
// reasoning, and read the history. The rules live in lib/onboarding-review.ts and
// are enforced again by the server actions.
import { useState, useTransition } from "react";
import { inputClass } from "@/components/build/DraftWithEarn";
import {
  recordOnboardingCheck,
  recordOnboardingDecision,
} from "@/app/(app)/[hub]/[module]/onboarding-actions";
import { OnboardingLinkPanel } from "@/components/run/OnboardingLinkPanel";
import { OnboardingSubmission, type SubmissionView } from "@/components/run/OnboardingSubmission";
import {
  CHECK_KINDS,
  CHECK_STATUS_LABEL,
  DECISION_LABEL,
  EXPIRY_CHOICES_DAYS,
  REASON_MAX,
  REVIEW_STATE_LABEL,
  SUMMARY_MAX,
  approvalBlocker,
  availableDecisions,
  decisionStageNote,
  isClear,
  reviewReadiness,
} from "@/lib/onboarding-review";
import type {
  LpReviewState,
  OnboardingCheckKind,
  OnboardingCheckStatus,
  OnboardingDecisionKind,
} from "@/lib/supabase/database.types";

export interface ReviewCheck {
  kind: OnboardingCheckKind;
  status: OnboardingCheckStatus;
  summary: string | null;
  checkedAt: string | null;
  expiresAt: string | null;
}

export interface ReviewDecision {
  id: string;
  decision: OnboardingDecisionKind;
  reason: string;
  decidedAt: string;
}

export interface ReviewActivity {
  id: number;
  text: string;
  at: string;
}

export interface ReviewLp {
  id: string;
  lpName: string;
  lpEmail: string;
  stageLabel: string;
  reviewState: LpReviewState;
  token: string;
  expiresAt: string;
  submission: SubmissionView;
  checks: ReviewCheck[];
  decisions: ReviewDecision[];
  activity: ReviewActivity[];
}

/** The shape the shared review rules read. */
const toState = (c: ReviewCheck) => ({ kind: c.kind, status: c.status, expires_at: c.expiresAt });

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const STATUS_TONE: Record<OnboardingCheckStatus, string> = {
  pending: "border-line text-fg-muted",
  clear: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  flagged: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  failed: "border-red-500/40 bg-red-500/10 text-red-300",
};

const DECISION_TONE: Record<OnboardingDecisionKind, string> = {
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  rejected: "border-red-500/40 bg-red-500/10 text-red-300",
  more_info: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

const pill = "rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider";

function CheckRow({ lpId, info, check }: { lpId: string; info: (typeof CHECK_KINDS)[number]; check?: ReviewCheck }) {
  const [status, setStatus] = useState<OnboardingCheckStatus>(check?.status ?? "pending");
  const [summary, setSummary] = useState(check?.summary ?? "");
  const [validFor, setValidFor] = useState<string>("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await recordOnboardingCheck({
        sessionId: lpId,
        kind: info.kind,
        status,
        summary,
        validForDays: status === "clear" && validFor ? Number(validFor) : null,
      }).catch(() => ({ ok: false as const, error: "Couldn't save. Try again." }));
      setMessage(res.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: res.error });
    });

  const expired = check?.status === "clear" && !isClear(toState(check));

  return (
    <div className="rounded-lg border border-line bg-surface-0 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg-primary">{info.label}</span>
        {!info.required ? <span className={`${pill} border-line text-fg-muted`}>Optional</span> : null}
        <span className={`${pill} ${expired ? STATUS_TONE.flagged : STATUS_TONE[check?.status ?? "pending"]}`}>
          {expired ? "Expired" : CHECK_STATUS_LABEL[check?.status ?? "pending"]}
        </span>
        {check?.checkedAt ? (
          <span className="font-mono text-[11px] text-fg-muted">
            checked {day(check.checkedAt)}
            {check.expiresAt ? `, valid to ${day(check.expiresAt)}` : ""}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-fg-muted">{info.hint}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_9rem_auto] sm:items-center">
        <select
          aria-label={`${info.label} status`}
          value={status}
          onChange={(e) => setStatus(e.target.value as OnboardingCheckStatus)}
          className={inputClass}
        >
          {(Object.keys(CHECK_STATUS_LABEL) as OnboardingCheckStatus[]).map((s) => (
            <option key={s} value={s}>
              {CHECK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          aria-label={`${info.label} note`}
          value={summary}
          maxLength={SUMMARY_MAX}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What you found (no ID numbers)"
          className={inputClass}
        />
        <select
          aria-label={`${info.label} valid for`}
          value={validFor}
          disabled={status !== "clear"}
          onChange={(e) => setValidFor(e.target.value)}
          className={`${inputClass} disabled:opacity-50`}
        >
          <option value="">No expiry</option>
          {EXPIRY_CHOICES_DAYS.map((d) => (
            <option key={d} value={d}>
              Valid {d} days
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          aria-label={`Save ${info.label}`}
          className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-1 text-[11px] ${message.tone === "error" ? "text-amber-400" : "text-emerald-300"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function DecisionForm({ lp, blocker }: { lp: ReviewLp; blocker: string | null }) {
  const options = availableDecisions(lp.reviewState);
  const stageNote = decisionStageNote(lp.reviewState);
  const [decision, setDecision] = useState<OnboardingDecisionKind>(options[0] ?? "rejected");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await recordOnboardingDecision({ sessionId: lp.id, decision, reason }).catch(() => ({
        ok: false as const,
        error: "Couldn't save. Try again.",
      }));
      if (res.ok) setReason("");
      setMessage(res.ok ? { tone: "ok", text: "Decision recorded." } : { tone: "error", text: res.error });
    });

  const blocked = decision === "approved" && blocker !== null;

  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface-0 p-3">
        <p className="text-sm font-medium text-fg-primary">Your decision</p>
        {stageNote ? <p className="mt-1 text-sm text-fg-secondary">{stageNote}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface-0 p-3">
      <p className="text-sm font-medium text-fg-primary">Your decision</p>
      {stageNote ? <p className="mt-1 text-xs text-amber-400">{stageNote}</p> : null}
      <p className="mt-1 text-xs text-fg-muted">
        Recorded with your reasoning and can&apos;t be edited afterwards. Record a new decision to change course.
      </p>
      <div className="mt-2 grid gap-2">
        <select aria-label="Decision" value={decision} onChange={(e) => setDecision(e.target.value as OnboardingDecisionKind)} className={`${inputClass} sm:w-72`}>
          {options.map((d) => (
            <option key={d} value={d}>
              {DECISION_LABEL[d]}
            </option>
          ))}
        </select>
        <textarea
          aria-label="Reasoning"
          value={reason}
          maxLength={REASON_MAX}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why. This is kept with the decision."
          className={inputClass}
        />
      </div>
      {blocked ? <p role="status" className="mt-2 text-xs text-amber-400">{blocker}</p> : null}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || blocked}
          onClick={submit}
          className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
        >
          {pending ? "Recording…" : "Record decision"}
        </button>
        {message ? (
          <span role={message.tone === "error" ? "alert" : "status"} className={`text-[11px] ${message.tone === "error" ? "text-amber-400" : "text-emerald-300"}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LpCard({ lp }: { lp: ReviewLp }) {
  const [open, setOpen] = useState(false);
  const readiness = reviewReadiness(lp.checks.map(toState));
  const blocker = approvalBlocker(readiness);
  const latest = lp.decisions[0];
  const byKind = new Map(lp.checks.map((c) => [c.kind, c]));

  return (
    <div className="rounded-xl border border-line bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg-primary">{lp.lpName}</p>
          <p className="truncate text-xs text-fg-muted">{lp.lpEmail}</p>
        </div>
        <span className={`${pill} ${lp.reviewState === "approved" ? STATUS_TONE.clear : lp.reviewState === "submitted" ? STATUS_TONE.flagged : "border-line text-fg-muted"}`}>
          {lp.reviewState === "approved" ? lp.stageLabel : REVIEW_STATE_LABEL[lp.reviewState]}
        </span>
        <span className={`${pill} ${readiness.ready ? STATUS_TONE.clear : STATUS_TONE.pending}`}>
          {readiness.ready ? "Checks clear" : `${readiness.notDone.length + readiness.flagged.length + readiness.expired.length} to resolve`}
        </span>
        {latest ? <span className={`${pill} ${DECISION_TONE[latest.decision]}`}>{DECISION_LABEL[latest.decision]}</span> : null}
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-fg-muted">{open ? "Close" : "Review →"}</span>
      </button>

      {open ? (
        <div className="grid gap-3 border-t border-line/50 px-4 py-3">
          {lp.reviewState !== "approved" && lp.reviewState !== "rejected" ? (
            <OnboardingLinkPanel sessionId={lp.id} token={lp.token} expiresAt={lp.expiresAt} />
          ) : null}
          <OnboardingSubmission view={lp.submission} />
          {CHECK_KINDS.map((info) => (
            <CheckRow key={info.kind} lpId={lp.id} info={info} check={byKind.get(info.kind)} />
          ))}
          <DecisionForm lp={lp} blocker={blocker} />

          {lp.decisions.length ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Decisions</p>
              <ul className="mt-1 grid gap-1">
                {lp.decisions.map((d) => (
                  <li key={d.id} className="text-xs text-fg-secondary">
                    <span className="text-fg-primary">{DECISION_LABEL[d.decision]}</span> · {day(d.decidedAt)} — {d.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {lp.activity.length ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Activity</p>
              <ul className="mt-1 grid gap-0.5">
                {lp.activity.map((a) => (
                  <li key={a.id} className="font-mono text-[11px] text-fg-muted">
                    {day(a.at)} · {a.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function OnboardingReview({ lps }: { lps: ReviewLp[] }) {
  return (
    <div className="flex flex-col gap-2">
      {lps.map((lp) => (
        <LpCard key={lp.id} lp={lp} />
      ))}
    </div>
  );
}
