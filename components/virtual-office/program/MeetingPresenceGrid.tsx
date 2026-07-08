"use client";

import { AGENT_BY_ID, roomLabel } from "./officeProgram";
import { useOfficeProgram } from "./useOfficeProgram";

const GOLD = "#c9a84c";

/**
 * Presence strip for the active work session.
 *
 * This is the AI floor's session roster, not a camera grid: the participants
 * are the executive agents in the meeting, and each card reflects that agent's
 * REAL runtime state from the office program store (its live status line and
 * the room it is working from) plus the local user's own presence. There are no
 * fabricated MediaStreams here — human peer video is carried separately by the
 * real WebRTC layer (VideoTileBar, driven by rtc/net) rendered directly below
 * this strip in the execution floor.
 */
export function MeetingPresenceGrid() {
  const s = useOfficeProgram();
  const meeting = s.meeting;
  if (!meeting) return null;

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2"
      style={{ borderColor: "rgba(201,168,76,0.18)", background: "#0a0806" }}
    >
      <div className="shrink-0 pr-2" style={{ borderRight: "1px solid rgba(201,168,76,0.15)" }}>
        <p className="text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD, fontFamily: "Georgia, serif" }}>
          {meeting.label}
        </p>
        <p className="text-[8px] text-slate-500">{roomLabel(meeting.roomKey)} · live session</p>
      </div>

      {/* Local user presence */}
      <PresenceCard name="You" role="Managing Partner" accent={GOLD} isUser status="In session" />

      {meeting.participants.map((agentId) => {
        const agent = AGENT_BY_ID[agentId];
        const runtime = s.agents[agentId];
        // Real status: whatever the agent is actually doing on the floor right
        // now (its live status line), falling back to its role while idle.
        const status = runtime && runtime.state !== "idle" ? runtime.statusLabel : agent.role;
        return (
          <PresenceCard
            key={agentId}
            name={agent.name}
            role={agent.role}
            accent={agent.accent}
            status={status}
          />
        );
      })}
    </div>
  );
}

function PresenceCard({
  name,
  role,
  accent,
  status,
  isUser,
}: {
  name: string;
  role: string;
  accent: string;
  status: string;
  isUser?: boolean;
}) {
  return (
    <div
      className="flex w-32 shrink-0 flex-col overflow-hidden rounded-md border"
      style={{ borderColor: `${accent}44`, background: "rgba(255,255,255,0.02)" }}
    >
      {/* Identity block: monogram + live-status caption. Honest presence, not a
          video feed — AI agents participate over the status channel. */}
      <div
        className="flex h-14 items-center gap-2 px-2"
        style={{ background: `linear-gradient(140deg, ${accent}18, rgba(10,8,6,0.9))` }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold"
          style={{ borderColor: `${accent}66`, color: accent }}
        >
          {name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </div>
        <p className="min-w-0 flex-1 truncate text-[8px] leading-tight text-slate-400" title={status}>
          {status}
        </p>
      </div>
      <div className="flex items-center justify-between px-1.5 py-1">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-medium text-slate-200">{name}</p>
          <p className="truncate text-[7px] text-slate-500">{role}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className="text-[8px]"
            style={{ color: isUser ? "#22c55e" : "#64748b" }}
            title={isUser ? "You are present in this session" : "AI agent — present on the status channel"}
          >
            {isUser ? "●" : "◉"}
          </span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} title="Present" />
        </div>
      </div>
    </div>
  );
}
