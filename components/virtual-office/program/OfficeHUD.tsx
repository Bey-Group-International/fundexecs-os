"use client";

import { Fragment, useState, type ReactNode } from "react";
import { RISK_TIERS, ROLE_LABELS, ROOM_BY_KEY, STAGE_LABELS, type RoomKey } from "./officeProgram";
import { useOfficeProgram } from "./useOfficeProgram";
import { AuditTable } from "./OfficeAuditDrawer";

const GOLD = "#c9a84c";

/**
 * Unified office status strip — one sleek inline line that always answers: what
 * state the office is in, its mode, what's executing, who's active, what needs
 * approval, where you are, your role, who's present, and the audit count. Folds
 * in the header metrics and the standalone audit trail (opened from the Audit
 * item) so the whole control surface reads as one bar above the floor.
 */
export function OfficeHUD({ currentRoom, presenceCount }: { currentRoom: string; presenceCount?: number }) {
  const s = useOfficeProgram();
  const wf = s.activeWorkflow;
  const [auditOpen, setAuditOpen] = useState(false);

  const agentsActive = Object.values(s.agents).filter((a) => a.state !== "idle").length;
  const openApprovals = s.approvals.filter((g) => g.status === "pending").length;
  const roomLabel = currentRoom
    ? ROOM_BY_KEY[currentRoom as RoomKey]?.label ?? currentRoom.charAt(0).toUpperCase() + currentRoom.slice(1)
    : "—";

  const statusLabel =
    s.officeStatus === "calm" ? "Calm" :
    s.officeStatus === "planning" ? "Planning" :
    s.officeStatus === "executing" ? "Executing" : "Awaiting approval";
  const statusColor =
    s.officeStatus === "calm" ? "#22c55e" :
    s.officeStatus === "awaiting_approval" ? "#f59e0b" : GOLD;
  const modeLabel = s.mode === "conversation" ? "Conversation" : s.mode === "copilot" ? "Copilot" : "Workflow";

  // Ordered items; contextual ones (stage/risk) only appear while a workflow runs.
  const items: ReactNode[] = [
    <Stat key="state" label="Office">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} aria-hidden />
        <span style={{ color: statusColor }}>{statusLabel}</span>
      </span>
    </Stat>,
    <Stat key="mode" label="Mode">{modeLabel}</Stat>,
    <Stat key="wf" label="Workflow" grow={!!wf}>
      <span className="truncate" style={{ color: wf ? "#fde68a" : undefined }}>{wf ? wf.title : "None active"}</span>
    </Stat>,
    ...(wf
      ? [
          <Stat key="stage" label="Stage">{STAGE_LABELS[wf.stage]}</Stat>,
          <Stat key="risk" label="Risk" title={RISK_TIERS[wf.riskTier].label}>
            <span style={{ color: RISK_TIERS[wf.riskTier].color }}>{RISK_TIERS[wf.riskTier].short}</span>
          </Stat>,
        ]
      : []),
    <Stat key="agents" label="Agents">{agentsActive}/11</Stat>,
    <Stat key="approvals" label="Approvals">
      <span style={{ color: openApprovals > 0 ? "#f59e0b" : undefined }}>
        {openApprovals > 0 ? `${openApprovals} open` : "None"}
      </span>
    </Stat>,
    <Stat key="room" label="Room">{roomLabel}</Stat>,
    <Stat key="role" label="Role">{ROLE_LABELS[s.userRole]}</Stat>,
    ...(presenceCount != null ? [<Stat key="presence" label="Present">{presenceCount} online</Stat>] : []),
  ];

  return (
    <div
      className="relative z-20 flex items-center gap-x-3 overflow-x-auto border-b px-3 py-1.5"
      style={{ borderColor: "#c9a84c18", background: "#0a0806", scrollbarWidth: "none" }}
    >
      {items.map((node, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="shrink-0 text-[9px] text-[#c9a84c40]" aria-hidden>·</span>}
          {node}
        </Fragment>
      ))}

      {/* Audit — folds the standalone trail into the strip; opens on click. */}
      <span className="shrink-0 text-[9px] text-[#c9a84c40]" aria-hidden>·</span>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setAuditOpen((v) => !v)}
          aria-expanded={auditOpen}
          className="flex items-baseline gap-1 whitespace-nowrap rounded px-1.5 py-0.5 transition-colors hover:bg-[#c9a84c14]"
          title="Audit trail"
        >
          <span className="text-[8px] uppercase tracking-[0.16em] text-slate-500" style={{ fontFamily: "Georgia, serif" }}>
            Audit
          </span>
          <span className="text-[11px] font-medium" style={{ color: "#e2e8f0", fontFamily: "Georgia, serif" }}>
            {s.audit.length}
          </span>
          <span className="text-[8px] text-slate-500">{auditOpen ? "▴" : "▾"}</span>
        </button>
        {auditOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setAuditOpen(false)} />
            <div
              className="absolute right-0 top-full z-40 mt-1 max-h-[300px] w-[520px] max-w-[86vw] overflow-y-auto rounded-xl border backdrop-blur-sm"
              style={{ borderColor: "rgba(201,168,76,0.3)", background: "rgba(10,8,6,0.97)" }}
            >
              <p className="border-b px-3 py-1.5 text-[10px] uppercase tracking-[0.22em]" style={{ color: GOLD, borderColor: "rgba(201,168,76,0.15)", fontFamily: "Georgia, serif" }}>
                Audit Trail
              </p>
              <AuditTable />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One inline status item: a small label above-baseline + its value, on one line. */
function Stat({ label, children, grow, title }: { label: string; children: ReactNode; grow?: boolean; title?: string }) {
  return (
    <span
      className={`flex items-baseline gap-1 whitespace-nowrap ${grow ? "min-w-0 flex-1" : "shrink-0"}`}
      title={title}
    >
      <span className="text-[8px] uppercase tracking-[0.16em] text-slate-500" style={{ fontFamily: "Georgia, serif" }}>
        {label}
      </span>
      <span className="truncate text-[11px] font-medium" style={{ color: "#e2e8f0", fontFamily: "Georgia, serif" }}>
        {children}
      </span>
    </span>
  );
}
