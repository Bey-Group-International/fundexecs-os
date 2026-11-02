"use client";

// components/execute/LPOnboardingStatus.tsx
// LP onboarding status board — shows all active onboarding sessions with progress.
import { useState, useTransition } from "react";
import type { OnboardingStatus } from "@/lib/lp-onboarding";
import { countersignSubscriptionAction } from "@/components/execute/countersign-actions";
import { buildOnboardingSteps, onboardingProgressPct } from "@/lib/lp-onboarding";

interface Session {
  id: string;
  lpName: string;
  /** Only owners and admins are given the LP's email. */
  lpEmail?: string;
  status: OnboardingStatus;
  fundName?: string;
  commitmentAmount?: number | null;
  expiresAt: string;
  /** When each side signed the subscription agreement; absent until they have. */
  lpSignedAt?: string | null;
  gpSignedAt?: string | null;
  /** The viewer may countersign (owner or admin). */
  canCountersign?: boolean;
}

const STATUS_COLOR: Record<OnboardingStatus, string> = {
  pending: "text-slate-400 border-slate-500/40 bg-slate-500/10",
  accreditation: "text-blue-400 border-blue-500/40 bg-blue-500/10",
  subscription: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  committed: "text-gold-300 border-gold-500/40 bg-gold-500/10",
  complete: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  expired: "text-red-400 border-red-500/40 bg-red-500/10",
};

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full bg-gold-500/70 transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SignatureRow({ session }: { session: Session }) {
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (!session.lpSignedAt) return null;
  const day = (iso: string) => iso.slice(0, 10);

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-0 p-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">Subscription agreement</p>
      <p className="mt-1 text-xs text-fg-secondary">
        LP signed {day(session.lpSignedAt)} ·{" "}
        {session.gpSignedAt ? `Fund countersigned ${day(session.gpSignedAt)}` : "Awaiting fund countersignature"}
      </p>
      <a
        href={`/api/lp-subscription/${session.id}`}
        className="mt-1 inline-block font-mono text-[11px] uppercase tracking-wider text-gold-300 hover:underline"
      >
        {session.gpSignedAt ? "Executed PDF →" : "Signed-so-far PDF →"}
      </a>
      {!session.gpSignedAt && session.canCountersign ? (
        <div className="mt-2 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            autoComplete="name"
            className="w-full rounded-md border border-line bg-surface-1 px-2.5 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
          />
          <label className="flex items-start gap-2 text-[11px] text-fg-secondary">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>I countersign this agreement on behalf of the fund.</span>
          </label>
          {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
          <button
            type="button"
            disabled={pending || !agreed || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                setError("");
                const r = await countersignSubscriptionAction(session.id, name.trim(), agreed);
                if (!r.ok) setError(r.error);
              })
            }
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
          >
            {pending ? "Signing…" : "Countersign"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SessionCard({ session }: { session: Session }) {
  const pct = onboardingProgressPct(session.status);
  const steps = buildOnboardingSteps(session.status);

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg-primary">{session.lpName}</p>
          {session.lpEmail && <p className="truncate text-xs text-fg-muted">{session.lpEmail}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${STATUS_COLOR[session.status]}`}
        >
          {session.status.replace("_", " ")}
        </span>
      </div>

      {session.fundName && (
        <p className="mt-2 text-xs text-fg-secondary">{session.fundName}</p>
      )}

      <div className="mt-3">
        <ProgressBar pct={pct} />
        <p className="mt-1 text-right font-mono text-[11px] text-fg-muted">{pct}% complete</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {steps.map((step) => (
          <span
            key={step.key}
            className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${
              step.completed
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : step.current
                  ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
                  : "border-line bg-surface-2 text-fg-muted"
            }`}
          >
            {step.completed ? "✓ " : step.current ? "→ " : ""}
            {step.label}
          </span>
        ))}
      </div>

      {session.commitmentAmount && (
        <p className="mt-2 font-mono text-xs text-gold-300">
          ${session.commitmentAmount.toLocaleString()} committed
        </p>
      )}

      <SignatureRow session={session} />
    </div>
  );
}

export function LPOnboardingStatus({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          No active onboarding sessions
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          Invite an LP to start their onboarding flow.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((s) => (
        <SessionCard key={s.id} session={s} />
      ))}
    </div>
  );
}
