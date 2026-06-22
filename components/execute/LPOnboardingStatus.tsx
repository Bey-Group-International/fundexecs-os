"use client";

// components/execute/LPOnboardingStatus.tsx
// LP onboarding status board — shows all active onboarding sessions with progress.
import type { OnboardingStatus } from "@/lib/lp-onboarding";
import { buildOnboardingSteps, onboardingProgressPct } from "@/lib/lp-onboarding";

interface Session {
  id: string;
  lpName: string;
  lpEmail: string;
  status: OnboardingStatus;
  fundName?: string;
  commitmentAmount?: number | null;
  expiresAt: string;
  token: string;
}

const STATUS_COLOR: Record<OnboardingStatus, string> = {
  pending: "text-slate-400 border-slate-500/40 bg-slate-500/10",
  accreditation: "text-blue-400 border-blue-500/40 bg-blue-500/10",
  subscription: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  committed: "text-gold-400 border-gold-500/40 bg-gold-500/10",
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

function SessionCard({ session }: { session: Session }) {
  const pct = onboardingProgressPct(session.status);
  const steps = buildOnboardingSteps(session.status);

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg-primary">{session.lpName}</p>
          <p className="truncate text-xs text-fg-muted">{session.lpEmail}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${STATUS_COLOR[session.status]}`}
        >
          {session.status.replace("_", " ")}
        </span>
      </div>

      {session.fundName && (
        <p className="mt-2 text-xs text-fg-secondary">{session.fundName}</p>
      )}

      <div className="mt-3">
        <ProgressBar pct={pct} />
        <p className="mt-1 text-right font-mono text-[10px] text-fg-muted">{pct}% complete</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {steps.map((step) => (
          <span
            key={step.key}
            className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${
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
        <p className="mt-2 font-mono text-xs text-gold-400">
          ${session.commitmentAmount.toLocaleString()} committed
        </p>
      )}
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
