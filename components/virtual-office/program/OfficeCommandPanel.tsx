"use client";

import { useEffect, useRef, useState } from "react";
import {
  MEETING_TYPES,
  SUGGESTED_COMMANDS,
  WORKFLOW_MODES,
  type ChatMessage,
  type MeetingType,
  type WorkflowMode,
} from "./officeProgram";
import {
  joinMeeting,
  leaveMeeting,
  setWorkflowMode,
  submitOfficeTask,
} from "./officeProgramStore";
import { useOfficeProgram } from "./useOfficeProgram";

const GOLD = "#c9a84c";

/**
 * Earn Command Center — the single entry point for work.
 * Commands route through Earn; office chat records meetings, agent
 * status, approval gates, and system notices in one auditable feed.
 */
export function OfficeCommandPanel() {
  const s = useOfficeProgram();
  const [input, setInput] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  // Keep the feed pinned to the latest message.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.chat.length]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    submitOfficeTask(text);
    setInput("");
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
      style={{ borderColor: "rgba(201,168,76,0.2)", background: "#0a0806" }}
    >
      {/* Header + mode selector */}
      <div className="border-b px-3 py-2" style={{ borderColor: "rgba(201,168,76,0.15)" }}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.22em]" style={{ color: GOLD, fontFamily: "Georgia, serif" }}>
            Earn Command Center
          </span>
          <span className="flex items-center gap-1 text-[9px] text-emerald-500/80">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Earn online
          </span>
        </div>
        <div className="mt-2 flex gap-1">
          {WORKFLOW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setWorkflowMode(m.id as WorkflowMode)}
              title={m.blurb}
              className="flex-1 rounded px-2 py-1 text-[9px] uppercase tracking-[0.14em] transition-colors"
              style={{
                fontFamily: "Georgia, serif",
                color: s.mode === m.id ? "#0a0806" : "#94a3b8",
                background: s.mode === m.id ? GOLD : "rgba(255,255,255,0.04)",
                border: `1px solid ${s.mode === m.id ? GOLD : "rgba(255,255,255,0.08)"}`,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
          {WORKFLOW_MODES.find((m) => m.id === s.mode)?.blurb}
        </p>
      </div>

      {/* Chat / event feed */}
      <div ref={feedRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {s.chat.map((msg) => (
          <ChatBubble key={msg.id} msg={msg} />
        ))}
      </div>

      {/* Meetings */}
      <div className="border-t px-3 py-2" style={{ borderColor: "rgba(201,168,76,0.12)" }}>
        {s.meeting ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px]" style={{ color: GOLD, fontFamily: "Georgia, serif" }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: GOLD }} />
              In meeting: {s.meeting.label}
            </span>
            <button
              type="button"
              onClick={leaveMeeting}
              className="rounded border px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
              style={{ borderColor: "rgba(255,255,255,0.12)" }}
            >
              Leave
            </button>
          </div>
        ) : (
          <details>
            <summary
              className="cursor-pointer list-none text-[9px] uppercase tracking-[0.18em] text-slate-500 hover:text-slate-300"
              style={{ fontFamily: "Georgia, serif" }}
            >
              ▸ Join a work session
            </summary>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(Object.keys(MEETING_TYPES) as MeetingType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => joinMeeting(t)}
                  className="rounded border px-2 py-0.5 text-[9px] text-slate-400 transition-colors hover:text-amber-300"
                  style={{ borderColor: "rgba(201,168,76,0.2)", fontFamily: "Georgia, serif" }}
                >
                  {MEETING_TYPES[t].label}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Suggested prompts + input */}
      <div className="border-t px-3 py-2" style={{ borderColor: "rgba(201,168,76,0.15)" }}>
        <div className="mb-2 flex flex-wrap gap-1">
          {SUGGESTED_COMMANDS.slice(0, 4).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => submitOfficeTask(c)}
              className="rounded-full border px-2 py-0.5 text-[9px] text-slate-400 transition-colors hover:border-amber-400/50 hover:text-amber-300"
              style={{ borderColor: "rgba(201,168,76,0.25)", fontFamily: "Georgia, serif" }}
            >
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex gap-1.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Give Earn a command…"
            maxLength={240}
            className="min-w-0 flex-1 rounded border bg-transparent px-2.5 py-1.5 text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-amber-400/50"
            style={{ borderColor: "rgba(201,168,76,0.25)" }}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
            style={{ background: GOLD, color: "#0a0806", fontFamily: "Georgia, serif" }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

const KIND_STYLE: Record<ChatMessage["kind"], { color: string; badge?: string }> = {
  user_command: { color: "#e2e8f0" },
  earn:         { color: "#fbbf24" },
  agent_update: { color: "#94a3b8" },
  system:       { color: "#64748b", badge: "SYSTEM" },
  approval:     { color: "#f59e0b", badge: "APPROVAL" },
  meeting:      { color: "#38bdf8", badge: "MEETING" },
};

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const style = KIND_STYLE[msg.kind];
  const isUser = msg.kind === "user_command";
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="text-[8px] uppercase tracking-[0.14em]" style={{ color: style.color, fontFamily: "Georgia, serif" }}>
          {msg.author}
        </span>
        {style.badge && (
          <span
            className="rounded-sm px-1 text-[7px] tracking-wider"
            style={{ background: `${style.color}22`, color: style.color }}
          >
            {style.badge}
          </span>
        )}
        <span className="text-[8px] text-slate-700">
          {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div
        className="max-w-[95%] rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed"
        style={{
          background: isUser ? "rgba(201,168,76,0.14)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${isUser ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.06)"}`,
          color: msg.kind === "agent_update" ? "#cbd5e1" : "#e2e8f0",
        }}
      >
        {msg.text}
      </div>
    </div>
  );
}
