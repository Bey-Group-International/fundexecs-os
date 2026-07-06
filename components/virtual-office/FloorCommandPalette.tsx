"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ROOMS } from "./types";
import { MEETING_TYPES, type MeetingType } from "./program/officeProgram";
import { joinMeeting } from "./program/officeProgramStore";

type Command = {
  id: string;
  label: string;
  hint: string;
  group: "Rooms" | "Meetings" | "Tools";
  run: () => void;
};

/**
 * A ⌘K-style launcher for the Executive Floor: type to jump to any room, start
 * any structured meeting, or open a floor tool. Composes the existing actions
 * (room teleport, joinMeeting, the Directory / meeting-modal window events) —
 * keyboard-first, no backend. Complements the visual Executive Directory.
 */
export function FloorCommandPalette({
  onRoom,
  onClose,
}: {
  onRoom: (roomKey: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const rooms: Command[] = ROOMS.map((r) => ({
      id: `room:${r.key}`,
      label: `Go to ${r.label}`,
      hint: "Room",
      group: "Rooms",
      run: () => onRoom(r.key),
    }));
    const meetings: Command[] = (Object.keys(MEETING_TYPES) as MeetingType[]).map((t) => ({
      id: `meeting:${t}`,
      label: `Start ${MEETING_TYPES[t].label}`,
      hint: "Meeting",
      group: "Meetings",
      run: () => joinMeeting(t),
    }));
    const tools: Command[] = [
      {
        id: "tool:directory",
        label: "Open Executive Directory",
        hint: "Tool",
        group: "Tools",
        run: () => window.dispatchEvent(new CustomEvent("office:open-directory")),
      },
      {
        id: "tool:meeting",
        label: "Start a video meeting",
        hint: "Tool",
        group: "Tools",
        run: () => window.dispatchEvent(new CustomEvent("office:start-meeting")),
      },
    ];
    return [...rooms, ...meetings, ...tools];
  }, [onRoom]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [commands, query]);

  // Keep the active index in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <>
      <div className="absolute inset-0 z-30" onClick={onClose} />
      <div
        className="pointer-events-auto absolute left-1/2 top-[18%] z-40 w-[360px] max-w-[92%] -translate-x-1/2 overflow-hidden rounded-2xl border shadow-xl backdrop-blur-sm"
        style={{
          background: "rgba(10,8,6,0.95)",
          borderColor: "rgba(201,168,76,0.35)",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
        onKeyDown={onKeyDown}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to a room, start a meeting, open a tool…"
          className="w-full border-b bg-transparent px-3.5 py-3 text-[13px] text-fg-primary outline-none"
          style={{ borderColor: "rgba(201,168,76,0.2)" }}
        />
        <ul ref={listRef} className="flex max-h-[320px] flex-col overflow-y-auto py-1.5">
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => runAt(i)}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors"
                style={{ background: i === active ? "rgba(201,168,76,0.14)" : "transparent" }}
              >
                <span className="truncate text-[13px] text-fg-primary">{c.label}</span>
                <span
                  className="ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em]"
                  style={{ color: "#c9a84c", background: "rgba(201,168,76,0.08)" }}
                >
                  {c.hint}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="px-3.5 py-4 text-center text-[11px] text-fg-muted">No actions match “{query}”.</li>
          ) : null}
        </ul>
        <div
          className="flex items-center gap-3 border-t px-3.5 py-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-fg-muted"
          style={{ borderColor: "rgba(201,168,76,0.15)" }}
        >
          <span>↑↓ move</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </>
  );
}
