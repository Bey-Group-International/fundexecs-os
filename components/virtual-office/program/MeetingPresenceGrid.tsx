"use client";

import { AGENT_BY_ID, ROOM_BY_KEY } from "./officeProgram";
import { useOfficeProgram } from "./useOfficeProgram";

const GOLD = "#c9a84c";

/**
 * Institutional video presence grid for the active work session.
 * Cards are mock placeholders today; the layout, labels, and presence
 * states are final so real streams can drop in without redesign.
 */
export function MeetingPresenceGrid() {
  const s = useOfficeProgram();
  const meeting = s.meeting;
  if (!meeting) return null;

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto rounded-lg border px-3 py-2"
      style={{ borderColor: "rgba(201,168,76,0.25)", background: "#0a0806" }}
    >
      <div className="shrink-0 pr-2" style={{ borderRight: "1px solid rgba(201,168,76,0.15)" }}>
        <p className="text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD, fontFamily: "Georgia, serif" }}>
          {meeting.label}
        </p>
        <p className="text-[8px] text-slate-500">{ROOM_BY_KEY[meeting.roomKey].label} · live session</p>
      </div>

      {/* Local user card */}
      <PresenceCard name="You" role="Managing Partner" accent={GOLD} isUser />

      {meeting.participants.map((agentId) => {
        const agent = AGENT_BY_ID[agentId];
        return <PresenceCard key={agentId} name={agent.name} role={agent.role} accent={agent.accent} />;
      })}
    </div>
  );
}

function PresenceCard({
  name,
  role,
  accent,
  isUser,
}: {
  name: string;
  role: string;
  accent: string;
  isUser?: boolean;
}) {
  return (
    <div
      className="flex w-32 shrink-0 flex-col overflow-hidden rounded-md border"
      style={{ borderColor: `${accent}44`, background: "rgba(255,255,255,0.02)" }}
    >
      {/*
        Future WebRTC integration:
        Attach the participant MediaStream here.
          videoElement.srcObject = remoteStream;
        The placeholder block below is replaced by a <video> element with
        identical dimensions; name/role/mic chrome stays unchanged.
      */}
      <div
        className="flex h-14 items-center justify-center"
        style={{ background: `linear-gradient(140deg, ${accent}18, rgba(10,8,6,0.9))` }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold"
          style={{ borderColor: `${accent}66`, color: accent }}
        >
          {name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </div>
      </div>
      <div className="flex items-center justify-between px-1.5 py-1">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-medium text-slate-200">{name}</p>
          <p className="truncate text-[7px] text-slate-500">{role}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Mic state: user unmuted, AI agents present via status channel */}
          <span className="text-[8px]" style={{ color: isUser ? "#22c55e" : "#64748b" }} title={isUser ? "Mic on" : "AI agent — status channel"}>
            {isUser ? "🎙" : "◉"}
          </span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#22c55e" }} title="Present" />
        </div>
      </div>
    </div>
  );
}
