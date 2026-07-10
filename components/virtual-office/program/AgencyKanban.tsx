"use client";

// Agency Kanban — a top-rail board view of the floor's work by pipeline stage.
//
// The office program runs one live workflow at a time (activeWorkflow) plus an
// archive of shipped / rejected ones (a projection of office_audit_log via the
// persisted office_workflows). This lays them across the delegation pipeline —
// Received → … → Complete (+ Blocked) — so you see, at a glance, where the live
// work sits and everything the team has shipped. Each in-flight card shows the
// executives assigned to it (team dots), matching "The Delegation"'s agency
// board adapted to the native workflow model.
import { FloorOverlay } from "./FloorOverlay";
import { useOfficeProgram } from "./useOfficeProgram";
import {
  AGENT_BY_ID,
  RISK_TIERS,
  STAGE_LABELS,
  STAGE_ORDER,
  type AgentId,
  type OfficeWorkflow,
  type RiskTier,
  type WorkflowStage,
} from "./officeProgram";
import type { ArchivedWorkflow } from "./officeProgramStore";
import { relativeTime } from "@/lib/office/floor-activity";

const GOLD = "#c9a84c";

// All pipeline columns, with Blocked appended (STAGE_ORDER omits it).
const COLUMNS: WorkflowStage[] = [...STAGE_ORDER, "blocked"];

function RiskChip({ tier }: { tier: RiskTier }) {
  const r = RISK_TIERS[tier];
  return (
    <span
      title={r.label}
      style={{ fontSize: 8, letterSpacing: "0.06em", color: r.color, background: `${r.color}18`, border: `1px solid ${r.color}44`, borderRadius: 999, padding: "1px 6px" }}
    >
      {r.short}
    </span>
  );
}

function ActiveCard({ wf }: { wf: OfficeWorkflow }) {
  const accent = "#c9a84c";
  const agents = wf.assignments.map((a) => a.agentId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, background: `${accent}10`, border: `1px solid ${accent}44`, borderRadius: 6, padding: "7px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <RiskChip tier={wf.riskTier} />
        <span style={{ marginLeft: "auto", fontSize: 8, color: "rgba(255,248,220,0.4)" }}>{wf.progress}%</span>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.35, color: "rgba(255,248,220,0.9)" }}>{wf.title}</div>
      {/* Progress bar */}
      <div style={{ height: 3, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${wf.progress}%`, background: wf.stage === "complete" ? "#22c55e" : accent, transition: "width 0.4s ease" }} />
      </div>
      <div style={{ fontSize: 8.5, color: "rgba(255,248,220,0.45)", lineHeight: 1.4 }}>{wf.currentStep}</div>
      {/* Team dots */}
      {agents.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
          {agents.map((id: AgentId, i) => (
            <span
              key={`${id}-${i}`}
              title={AGENT_BY_ID[id]?.name ?? id}
              style={{ width: 7, height: 7, borderRadius: "50%", background: AGENT_BY_ID[id]?.accent ?? GOLD, boxShadow: `0 0 5px ${AGENT_BY_ID[id]?.accent ?? GOLD}88` }}
            />
          ))}
          <span style={{ marginLeft: 2, fontSize: 8, color: "rgba(255,248,220,0.4)" }}>
            {agents.length} on it
          </span>
        </div>
      )}
    </div>
  );
}

function ArchivedCard({ wf, now }: { wf: ArchivedWorkflow; now: number }) {
  const done = wf.outcome === "complete";
  const dot = done ? "#22c55e" : "#ef4444";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "6px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: dot }} />
        <RiskChip tier={wf.riskTier} />
        <span style={{ marginLeft: "auto", fontSize: 8, color: "rgba(255,248,220,0.35)" }}>{relativeTime(wf.completedAt, now)}</span>
      </div>
      <div style={{ fontSize: 10.5, lineHeight: 1.35, color: "rgba(255,248,220,0.72)" }}>{wf.title}</div>
    </div>
  );
}

export function AgencyKanban({ onClose }: { onClose: () => void }) {
  const s = useOfficeProgram();
  const now = Date.now();
  const active = s.activeWorkflow;
  const archive = [...s.archive].sort((a, b) => b.completedAt - a.completedAt);

  const totalWork = (active ? 1 : 0) + archive.length;

  // Cards per column: the live workflow sits in its stage; archived workflows
  // land in Complete (shipped) or Blocked (rejected).
  const cardsFor = (stage: WorkflowStage) => {
    const activeHere = active && active.stage === stage ? active : null;
    let archivedHere: ArchivedWorkflow[] = [];
    if (stage === "complete") archivedHere = archive.filter((a) => a.outcome === "complete");
    else if (stage === "blocked") archivedHere = archive.filter((a) => a.outcome === "rejected");
    return { activeHere, archivedHere, count: (activeHere ? 1 : 0) + archivedHere.length };
  };

  return (
    <FloorOverlay
      accent={GOLD}
      onClose={onClose}
      ariaLabel="Agency board"
      maxWidth={760}
      eyebrow="Agency board"
      title="Work across the floor"
      subtitle={`${totalWork} workflow${totalWork === 1 ? "" : "s"} · live pipeline + shipped history`}
    >
      {totalWork === 0 ? (
        <div style={{ padding: "24px 8px", textAlign: "center", fontSize: 11, color: "rgba(255,248,220,0.5)", fontFamily: "monospace" }}>
          No workflows yet. Delegate a task from the floor (walk up to an executive, or ⌘K) and it&apos;ll flow across the board here.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {COLUMNS.map((stage) => {
            const { activeHere, archivedHere, count } = cardsFor(stage);
            const blocked = stage === "blocked";
            return (
              <div key={stage} style={{ flex: "0 0 156px", width: 156, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 2, borderBottom: `1px solid ${blocked ? "#ef444433" : `${GOLD}22`}` }}>
                  <span style={{ fontFamily: "Georgia,serif", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: blocked ? "#ef4444aa" : `${GOLD}cc` }}>
                    {STAGE_LABELS[stage]}
                  </span>
                  <span style={{ fontSize: 8, color: "rgba(255,248,220,0.35)" }}>{count}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 24 }}>
                  {activeHere && <ActiveCard wf={activeHere} />}
                  {archivedHere.map((wf) => (
                    <ArchivedCard key={wf.id} wf={wf} now={now} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </FloorOverlay>
  );
}
