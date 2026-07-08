"use client";

// Top-level split-pane orchestrator for the Command Center.
//
//   Left  — Earn chat composer (Flow A / Flow B, approvals).
//   Right — the live spatial office world (WorldCanvas) with a top status bar,
//           a minimap, and hover/click room + executive detail panels.
//
// State seam: the world runs on the demo data source + scripted Earn driver
// from lib/command-center/adapter.ts. Replacing those with live agent/task data
// and a live Earn needs no changes here.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { buildMap, ROOMS, ROOM_BY_ID } from "@/lib/command-center/map";
import { WorldEngine } from "@/lib/command-center/engine";
import { demoDataSource, liveEarnDriver, scriptedEarnDriver } from "@/lib/command-center/adapter";
import type { FlowDescriptor } from "@/lib/command-center/flows";
import { WorldCanvas } from "./WorldCanvas";
import { ChatPane } from "./ChatPane";

function useEngineState(engine: WorldEngine) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => engine.subscribe(force), [engine]);
  return { chat: engine.getChat(), status: engine.getStatus() };
}

export function CommandCenter() {
  const engine = useMemo(() => new WorldEngine(buildMap(), demoDataSource.getRoster()), []);
  const { chat, status } = useEngineState(engine);
  const flows = useMemo(() => scriptedEarnDriver.listFlows(), []);

  const [hover, setHover] = useState<{ roomId: string | null; avatarId: string | null }>({
    roomId: null,
    avatarId: null,
  });
  const [selected, setSelected] = useState<{ roomId: string | null; avatarId: string | null }>({
    roomId: null,
    avatarId: null,
  });
  const [booted, setBooted] = useState(false);
  const launchedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 60);
    return () => clearTimeout(t);
  }, []);

  const launch = (flow: FlowDescriptor) => {
    launchedRef.current = true;
    setSelected({ roomId: null, avatarId: null });
    engine.startFlow(flow.kind, flow.steps);
  };

  const prompt = async (text: string) => {
    // Live Earn (Claude) chooses the flow and writes the dialogue for this
    // directive; it falls back to the scripted driver on any error. The plan's
    // opening user line already carries the operator's own words.
    const plan = await liveEarnDriver.plan(text);
    launchedRef.current = true;
    engine.startFlow(plan.kind, plan.steps);
  };

  const selectedAvatar = selected.avatarId
    ? [...engine.avatars.values()].find((a) => a.def.id === selected.avatarId)
    : null;
  const selectedRoom = selected.roomId ? ROOM_BY_ID[selected.roomId] : null;

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[560px] overflow-hidden rounded-2xl border border-line bg-surface-0 shadow-[0_30px_90px_-50px_rgba(56,189,248,0.5)]">
      {/* Left: chat */}
      <div className="w-[360px] shrink-0">
        <ChatPane
          chat={chat}
          status={status}
          flows={flows}
          onLaunch={launch}
          onApprove={() => engine.approve()}
          onReset={() => {
            launchedRef.current = false;
            setSelected({ roomId: null, avatarId: null });
            engine.reset();
          }}
          onPrompt={prompt}
        />
      </div>

      {/* Right: world */}
      <div className="relative flex-1 overflow-hidden bg-[#03060d]">
        {/* Top status bar */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-line/60 bg-surface-0/70 px-4 py-2.5 backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(56,189,248,0.7)]" />
          <p className="font-display text-sm font-semibold text-fg-primary">Command Center</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {status.flow ? `Flow ${status.flow}` : "Idle"} · {status.active.length} executing
          </p>
          <Link
            href="/dashboard"
            className="ml-auto rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/45 hover:text-fg-secondary"
          >
            ← Dashboard
          </Link>
        </div>

        {/* Boot/zoom-in transition into the grid. */}
        <div
          className="absolute inset-0 transition-all duration-700 ease-out"
          style={{
            transform: booted ? "scale(1)" : "scale(1.08)",
            opacity: booted ? 1 : 0,
          }}
        >
          <WorldCanvas
            engine={engine}
            selectedId={selected.avatarId ?? selected.roomId}
            onHover={setHover}
            onSelect={(info) =>
              setSelected(info.avatarId || info.roomId ? info : { roomId: null, avatarId: null })
            }
          />
        </div>

        {/* Hover hint */}
        {(hover.avatarId || hover.roomId) && !selected.avatarId && !selected.roomId && (
          <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-lg border border-line bg-surface-0/85 px-3 py-1.5 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {hover.avatarId
                ? engine.avatars.get(hover.avatarId)?.def.name
                : ROOM_BY_ID[hover.roomId ?? ""]?.name}
            </p>
          </div>
        )}

        {/* Detail panel */}
        {(selectedAvatar || selectedRoom) && (
          <div className="absolute bottom-4 left-4 z-10 w-72 rounded-xl border border-line bg-surface-0/90 p-3.5 backdrop-blur">
            <button
              onClick={() => setSelected({ roomId: null, avatarId: null })}
              className="absolute right-2.5 top-2.5 font-mono text-[10px] text-fg-muted hover:text-fg-secondary"
            >
              ✕
            </button>
            {selectedAvatar ? (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: selectedAvatar.def.color }}
                  />
                  <p className="font-display text-sm font-semibold text-fg-primary">
                    {selectedAvatar.def.name}
                  </p>
                </div>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  {selectedAvatar.def.role}
                </p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <Row label="Status" value={selectedAvatar.state} />
                  <Row
                    label="Task"
                    value={selectedAvatar.task ?? "Standing by"}
                  />
                  <Row label="Home" value={ROOM_BY_ID[selectedAvatar.def.homeRoom]?.name ?? "—"} />
                  {selectedAvatar.state === "work" && (
                    <Row label="Progress" value={`${Math.round(selectedAvatar.progress * 100)}%`} />
                  )}
                </dl>
              </>
            ) : selectedRoom ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: selectedRoom.accent }} />
                  <p className="font-display text-sm font-semibold text-fg-primary">
                    {selectedRoom.name}
                  </p>
                </div>
                <p className="mt-1 text-xs text-fg-muted">{selectedRoom.workflow}</p>
                <div className="mt-3">
                  <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    On the floor
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {[...engine.avatars.values()]
                      .filter((a) => a.def.homeRoom === selectedRoom.id)
                      .map((a) => (
                        <span
                          key={a.def.id}
                          className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-fg-secondary"
                        >
                          {a.def.name}
                        </span>
                      ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* Minimap */}
        <Minimap activeRoomId={selected.roomId ?? hover.roomId} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="truncate capitalize text-fg-secondary">{value}</dd>
    </div>
  );
}

function Minimap({ activeRoomId }: { activeRoomId: string | null }) {
  // Compact SVG schematic of the floor — rooms as accent-tinted blocks.
  const W = 44;
  const H = 28;
  return (
    <div className="absolute right-4 top-14 z-10 rounded-lg border border-line bg-surface-0/80 p-1.5 backdrop-blur">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-32">
        <rect x={0} y={0} width={W} height={H} fill="#03060d" rx={1.5} />
        {ROOMS.map((r) => {
          const active = activeRoomId === r.id;
          return (
            <g key={r.id}>
              <rect
                x={r.rect.x}
                y={r.rect.y}
                width={r.rect.w}
                height={r.rect.h}
                fill={r.accent}
                opacity={active ? 0.85 : 0.32}
                rx={1}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
