"use client";

import { RISK_TIERS, ROOM_BY_KEY, STAGE_LABELS, type RoomKey } from "./officeProgram";
import { useOfficeProgram } from "./useOfficeProgram";

const GOLD = "#c9a84c";

/**
 * Institutional HUD strip — always answers: what mode is the office in,
 * what is executing, who is active, and what needs the user's approval.
 */
export function OfficeHUD({ currentRoom }: { currentRoom: string }) {
  const s = useOfficeProgram();
  const wf = s.activeWorkflow;
  const agentsActive = Object.values(s.agents).filter((a) => a.state !== "idle").length;
  const openApprovals = s.approvals.filter((g) => g.status === "pending").length;
  const roomLabel = currentRoom ? ROOM_BY_KEY[currentRoom as RoomKey]?.label ?? currentRoom : "—";

  const statusLabel =
    s.officeStatus === "calm" ? "Calm" :
    s.officeStatus === "planning" ? "Planning" :
    s.officeStatus === "executing" ? "Executing" : "Awaiting approval";

  const statusColor =
    s.officeStatus === "calm" ? "#22c55e" :
    s.officeStatus === "awaiting_approval" ? "#f59e0b" : GOLD;

  return (
    <div
      className="flex flex-wrap items-stretch gap-px overflow-hidden rounded-lg border"
      style={{ borderColor: "rgba(201,168,76,0.2)", background: "rgba(201,168,76,0.12)" }}
    >
      <HudCell label="Mode" value={s.mode === "conversation" ? "Conversation" : s.mode === "copilot" ? "Copilot" : "Workflow"} />
      <HudCell label="Office" value={statusLabel} valueColor={statusColor} />
      <HudCell label="Workflow" value={wf ? wf.title : "None active"} grow />
      <HudCell label="Stage" value={wf ? STAGE_LABELS[wf.stage] : "—"} />
      <HudCell
        label="Risk tier"
        value={wf ? RISK_TIERS[wf.riskTier].short : "—"}
        valueColor={wf ? RISK_TIERS[wf.riskTier].color : undefined}
        title={wf ? RISK_TIERS[wf.riskTier].label : undefined}
      />
      <HudCell label="Agents active" value={`${agentsActive}/11`} />
      <HudCell
        label="Approvals"
        value={openApprovals > 0 ? `${openApprovals} open` : "None"}
        valueColor={openApprovals > 0 ? "#f59e0b" : undefined}
      />
      <HudCell label="Your room" value={roomLabel} />
      <HudCell label="Audit" value={`${s.audit.length} events`} />
    </div>
  );
}

function HudCell({
  label,
  value,
  valueColor,
  title,
  grow,
}: {
  label: string;
  value: string;
  valueColor?: string;
  title?: string;
  grow?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[92px] flex-col justify-center px-3 py-1.5 ${grow ? "flex-1" : ""}`}
      style={{ background: "#0a0806" }}
      title={title}
    >
      <span className="text-[8px] uppercase tracking-[0.18em] text-slate-500" style={{ fontFamily: "Georgia, serif" }}>
        {label}
      </span>
      <span
        className="truncate text-[11px] font-medium"
        style={{ color: valueColor ?? "#e2e8f0", fontFamily: "Georgia, serif" }}
      >
        {value}
      </span>
    </div>
  );
}
