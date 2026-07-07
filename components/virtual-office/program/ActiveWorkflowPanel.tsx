"use client";

import {
  AGENT_BY_ID,
  RISK_TIERS,
  ROLE_LABELS,
  ROOM_BY_KEY,
  STAGE_LABELS,
  STAGE_ORDER,
  canRoleApprove,
  rolesForTier,
  type WorkflowStage,
} from "./officeProgram";
import {
  approvePendingPlan,
  dismissPendingPlan,
  resolveApprovalGate,
} from "./officeProgramStore";
import { useOfficeProgram } from "./useOfficeProgram";

const GOLD = "#c9a84c";

/**
 * Persistent work-visibility layer: active workflow, stage tracker,
 * agent ownership badges, approval gates, and the "What's happening now"
 * confidence summary. The user should never have to infer office state
 * from animation alone.
 */
export function ActiveWorkflowPanel({ onDismiss }: { onDismiss?: () => void }) {
  const s = useOfficeProgram();
  const wf = s.activeWorkflow;
  const pendingGate = s.approvals.find((g) => g.status === "pending");

  return (
    <div
      className="flex flex-col gap-2.5 overflow-hidden rounded-lg border p-3"
      style={{ borderColor: "rgba(201,168,76,0.2)", background: "#0a0806" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.22em]" style={{ color: GOLD, fontFamily: "Georgia, serif" }}>
          Active Work
        </span>
        <span className="flex items-center gap-2">
          {wf && (
            <span
              className="rounded-sm border px-1.5 py-0.5 text-[8px] uppercase tracking-wider"
              style={{ color: RISK_TIERS[wf.riskTier].color, borderColor: `${RISK_TIERS[wf.riskTier].color}55` }}
            >
              {RISK_TIERS[wf.riskTier].label}
            </span>
          )}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Hide Active Work"
              title="Hide Active Work"
              className="grid h-5 w-5 place-items-center rounded text-[11px] leading-none transition-colors hover:text-fg-primary"
              style={{ color: "#9aa4b2", border: "1px solid rgba(201,168,76,0.3)" }}
            >
              ✕
            </button>
          ) : null}
        </span>
      </div>

      {/* Copilot plan approval */}
      {s.pendingPlan && (
        <div className="rounded-md border p-2.5" style={{ borderColor: "rgba(201,168,76,0.4)", background: "rgba(201,168,76,0.07)" }}>
          <p className="text-[10px] font-semibold" style={{ color: GOLD, fontFamily: "Georgia, serif" }}>
            Plan ready: {s.pendingPlan.routing.title}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-slate-400">
            {s.pendingPlan.routing.assignments.length} agents · {s.pendingPlan.routing.activeRooms.length} rooms ·{" "}
            {RISK_TIERS[s.pendingPlan.routing.riskTier].label}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={approvePendingPlan}
              className="flex-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: GOLD, color: "#0a0806" }}
            >
              Approve plan
            </button>
            <button
              type="button"
              onClick={dismissPendingPlan}
              className="rounded border px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 hover:text-slate-200"
              style={{ borderColor: "rgba(255,255,255,0.15)" }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Approval gate — impossible to miss */}
      {pendingGate && (
        <div
          className="rounded-md border p-2.5"
          style={{
            borderColor: `${RISK_TIERS[pendingGate.tier].color}88`,
            background: `${RISK_TIERS[pendingGate.tier].color}11`,
          }}
        >
          <p className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: RISK_TIERS[pendingGate.tier].color }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: RISK_TIERS[pendingGate.tier].color }} />
            {pendingGate.title}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-slate-400">{pendingGate.reason}</p>
          {(() => {
            const authorized = canRoleApprove(s.userRole, pendingGate.tier);
            return (
              <>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={!authorized}
                    title={authorized ? undefined : `Requires ${rolesForTier(pendingGate.tier)}`}
                    onClick={() => resolveApprovalGate(pendingGate.id, "approved")}
                    className="flex-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: "#16a34a" }}
                  >
                    {authorized ? "Approve" : "🔒 Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveApprovalGate(pendingGate.id, "rejected")}
                    className="flex-1 rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ borderColor: "#ef444488", color: "#ef4444" }}
                  >
                    Reject
                  </button>
                </div>
                <p className="mt-1.5 text-[9px] leading-snug text-slate-500">
                  Acting as <span style={{ color: "#c9a84c" }}>{ROLE_LABELS[s.userRole]}</span>.{" "}
                  {authorized
                    ? "You are authorized to clear this gate."
                    : `Only ${rolesForTier(pendingGate.tier)} may approve — you can still reject.`}
                </p>
              </>
            );
          })()}
        </div>
      )}

      {wf ? (
        <>
          <div>
            <p className="text-[12px] font-semibold text-slate-100" style={{ fontFamily: "Georgia, serif" }}>
              {wf.title}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Owner: Earn · {wf.etaLabel}
            </p>
          </div>

          <StageTracker stage={wf.stage} />

          {/* Overall progress */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[9px] text-slate-500">
              <span>Progress</span>
              <span style={{ color: GOLD }}>{wf.progress}%</span>
            </div>
            <ProgressBar value={wf.progress} color={GOLD} />
          </div>

          {/* Agent ownership badges */}
          <div className="space-y-1.5">
            {wf.assignments.map((a) => {
              const agent = AGENT_BY_ID[a.agentId];
              return (
                <div key={a.agentId} className="rounded border px-2 py-1.5" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-200">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: agent.accent }} />
                      {agent.name}
                    </span>
                    <span className="text-[9px] text-slate-500">{ROOM_BY_KEY[a.roomKey].label}</span>
                  </div>
                  <p className="mt-0.5 text-[9px] text-slate-400">
                    Owns: <span className="text-slate-300">{a.owns}</span> · {a.done ? "Complete" : a.status}
                  </p>
                  <div className="mt-1">
                    <ProgressBar value={a.progress} color={a.done ? "#22c55e" : agent.accent} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded border px-2 py-1.5 text-[10px]" style={{ borderColor: "rgba(201,168,76,0.15)" }}>
            <span className="text-slate-500">Next action: </span>
            <span className="text-slate-200">{wf.nextAction}</span>
          </div>
        </>
      ) : (
        !s.pendingPlan && (
          <p className="text-[10px] leading-relaxed text-slate-500">
            No active workflow. Earn is available, agents are online, and there are no open approvals.
          </p>
        )
      )}

      {/* What's happening now — the confidence layer */}
      <div className="rounded-md border p-2" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <p className="text-[8px] uppercase tracking-[0.18em] text-slate-500" style={{ fontFamily: "Georgia, serif" }}>
          What&apos;s happening now
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-300">{s.happeningNow}</p>
      </div>

      {/* Archive */}
      {s.archive.length > 0 && (
        <details>
          <summary className="cursor-pointer list-none text-[9px] uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300" style={{ fontFamily: "Georgia, serif" }}>
            ▸ Archived work ({s.archive.length})
          </summary>
          <div className="mt-1.5 space-y-1">
            {s.archive.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border px-2 py-1 text-[9px]" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <span className="truncate text-slate-400">{a.title}</span>
                <span style={{ color: a.outcome === "complete" ? "#22c55e" : "#ef4444" }}>
                  {a.outcome === "complete" ? "Complete" : "Rejected"}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StageTracker({ stage }: { stage: WorkflowStage }) {
  const currentIdx = STAGE_ORDER.indexOf(stage === "blocked" ? "approval" : stage);
  return (
    <div>
      <div className="flex items-center gap-0.5">
        {STAGE_ORDER.map((st, i) => {
          const done = i < currentIdx || stage === "complete";
          const current = i === currentIdx && stage !== "complete";
          return (
            <div key={st} className="flex-1" title={STAGE_LABELS[st]}>
              <div
                className="h-1 rounded-full transition-colors"
                style={{
                  background: done ? "#22c55e" : current ? GOLD : "rgba(255,255,255,0.08)",
                  ...(current ? { boxShadow: `0 0 6px ${GOLD}88` } : {}),
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[8px] uppercase tracking-wider text-slate-600">
          {STAGE_LABELS[STAGE_ORDER[0]]}
        </span>
        <span className="text-[9px] font-medium" style={{ color: stage === "blocked" ? "#ef4444" : GOLD, fontFamily: "Georgia, serif" }}>
          {stage === "blocked" ? "Blocked: approval was rejected" : STAGE_LABELS[stage]}
        </span>
        <span className="text-[8px] uppercase tracking-wider text-slate-600">
          {STAGE_LABELS[STAGE_ORDER[STAGE_ORDER.length - 1]]}
        </span>
      </div>
    </div>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${value}%`, background: color }}
      />
    </div>
  );
}
