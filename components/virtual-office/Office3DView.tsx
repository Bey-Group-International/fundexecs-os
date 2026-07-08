"use client";

/**
 * FundExecs OS — 3D office view (Phase 2b composition root).
 *
 * An opt-in alternative to the Phaser `VirtualOfficeGame`, mounted only when
 * `NEXT_PUBLIC_OFFICE_RENDERER=3d` (see OfficeTabs). It drives the native
 * `ThreeOfficeRenderer` from the SAME office program store the Phaser floor
 * uses, so the two are fed identical agent state:
 *
 *   • subscribes to the program store; each executive agent becomes a 3D actor
 *     placed at its current room (spread so co-located agents don't overlap),
 *   • re-targets an actor when its `roomKey` changes — the renderer routes it
 *     across the floor with A* pathfinding, so room transitions read as walking,
 *   • maps `state` to the renderer (emissive tint + animation clip),
 *   • forwards avatar clicks as the same `{ npcId, spriteKey, name }` payload
 *     the Phaser office emits, so the agent inspector works unchanged, and
 *   • gives YOU a click-to-walk avatar: click the floor to walk there, and the
 *     executive you stop beside greets you (proximity dialogue), mirroring the
 *     2D office's presence card.
 *
 * The heavy Three.js renderer is imported dynamically inside the effect, so it
 * never loads on the server or unless this view is actually shown.
 */

import { useEffect, useRef, useState } from "react";
import type { OfficeRenderer } from "./render/OfficeRenderer";
import { AGENT_BY_ID, type AgentId } from "./program/officeProgram";
import { AGENT_QUIPS } from "./program/agentQuips";
import {
  getOfficeProgramState,
  subscribeOfficeProgram,
  type OfficeProgramState,
} from "./program/officeProgramStore";
import {
  actorsWithin,
  DEFAULT_GREET_RADIUS_PX,
  type ActorPoint,
} from "./nav/officeProximity";
import { ROOMS, ROOM_W, ROOM_H } from "./types";

/** The click payload shape shared with the Phaser office (`onNpcClick`). */
export type NpcClickPayload = { npcId: string; spriteKey: string; name: string };

/** Stable id for the local user's click-to-walk avatar. */
const USER_ID = "__user__";
/** Re-check proximity at most this often (ms) — cheap, and setState only on change. */
const PROXIMITY_INTERVAL_MS = 250;

/** A greeting from the executive you're standing beside. */
type Greeting = { name: string; quip: string };

/** Room center in top-down office pixels (honors the wide Marketplace span). */
function roomCenterPx(roomKey: string): { x: number; y: number } {
  const room = ROOMS.find((r) => r.key === roomKey);
  if (!room) return { x: ROOM_W / 2, y: ROOM_H / 2 };
  const cols = room.colSpan ?? 1;
  return {
    x: room.col * ROOM_W + (ROOM_W * cols) / 2,
    y: room.row * ROOM_H + ROOM_H / 2,
  };
}

/** Deterministic spread offset for the i-th agent sharing a room (3-wide grid). */
function spreadOffset(i: number): { dx: number; dy: number } {
  return { dx: ((i % 3) - 1) * 76, dy: (Math.floor(i / 3) - 1) * 64 };
}

export function Office3DView({
  active = true,
  onNpcClick,
}: {
  active?: boolean;
  onNpcClick?: (payload: NpcClickPayload) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onNpcClick);
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  useEffect(() => {
    onClickRef.current = onNpcClick;
  }, [onNpcClick]);

  useEffect(() => {
    if (!active) return;
    let renderer: OfficeRenderer | null = null;
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    let proximityRaf = 0;
    const placed = new Set<string>();
    let lastProximity = 0;
    let shownGreetId: string | null = null;

    const applyState = (state: OfficeProgramState) => {
      if (!renderer) return;
      // Group agents by room so co-located executives get distinct offsets.
      const byRoom = new Map<string, AgentId[]>();
      for (const id of Object.keys(state.agents) as AgentId[]) {
        const roomKey = state.agents[id].roomKey;
        const list = byRoom.get(roomKey) ?? [];
        list.push(id);
        byRoom.set(roomKey, list);
      }
      for (const [roomKey, ids] of byRoom) {
        const center = roomCenterPx(roomKey);
        ids.forEach((id, i) => {
          const runtime = state.agents[id];
          const meta = AGENT_BY_ID[id];
          if (!meta) return;
          const { dx, dy } = spreadOffset(i);
          const x = center.x + dx;
          const y = center.y + dy;
          if (!placed.has(id)) {
            renderer!.addActor({
              id,
              x,
              y,
              facing: "down",
              name: meta.name,
              agentId: id,
              spriteKey: meta.spriteKey,
              accent: meta.accent,
              state: runtime.state,
              kind: "agent",
            });
            placed.add(id);
          } else {
            renderer!.moveActor(id, x, y); // A*-routed by the renderer → reads as walking
          }
          renderer!.setActorState(id, runtime.state);
        });
      }
    };

    // Poll proximity between the user avatar and the executives; surface a
    // greeting from the nearest one you're standing beside (pure pixel math).
    const checkProximity = () => {
      proximityRaf = requestAnimationFrame(checkProximity);
      if (!renderer?.actorPixel) return;
      const now = performance.now();
      if (now - lastProximity < PROXIMITY_INTERVAL_MS) return;
      lastProximity = now;

      const me = renderer.actorPixel(USER_ID);
      if (!me) return;
      const points: ActorPoint[] = [];
      for (const id of placed) {
        const p = renderer.actorPixel(id);
        if (p) points.push({ id, x: p.x, y: p.y });
      }
      const near = actorsWithin(me, points, DEFAULT_GREET_RADIUS_PX);
      const nearestId = near[0]?.id ?? null;
      if (nearestId === shownGreetId) return; // no change → no setState
      shownGreetId = nearestId;
      if (!nearestId) {
        setGreeting(null);
        return;
      }
      const meta = AGENT_BY_ID[nearestId as AgentId];
      const quips = AGENT_QUIPS[nearestId as AgentId];
      if (meta && quips?.length) setGreeting({ name: meta.name, quip: quips[0] });
    };

    void (async () => {
      const { ThreeOfficeRenderer } = await import("./render/ThreeOfficeRenderer");
      if (disposed || !containerRef.current) return;
      const r = new ThreeOfficeRenderer();
      renderer = r;
      await r.mount(containerRef.current);
      if (disposed) {
        r.destroy();
        renderer = null;
        return;
      }
      r.buildFloor();
      r.onActorClick((id) => {
        const meta = AGENT_BY_ID[id as AgentId];
        if (meta) onClickRef.current?.({ npcId: `agent:${id}`, spriteKey: meta.spriteKey, name: meta.name });
      });
      // Your click-to-walk avatar, dropped at reception.
      const start = roomCenterPx("reception");
      r.addActor({
        id: USER_ID,
        x: start.x,
        y: start.y,
        facing: "down",
        name: "You",
        agentId: null,
        accent: "#c9a84c",
        kind: "user",
      });
      // Click empty floor → walk there (the renderer routes around walls).
      r.onFloorClick((x, y) => renderer?.moveActor(USER_ID, x, y));
      // The store notifies with no payload; pull the current snapshot each time.
      applyState(getOfficeProgramState());
      unsubscribe = subscribeOfficeProgram(() => applyState(getOfficeProgramState()));
      proximityRaf = requestAnimationFrame(checkProximity);
    })();

    return () => {
      disposed = true;
      if (proximityRaf) cancelAnimationFrame(proximityRaf);
      unsubscribe?.();
      renderer?.destroy();
      renderer = null;
    };
  }, [active]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      {greeting && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <div className="max-w-[80%] rounded-xl border border-gold-400/40 bg-surface-0/90 px-4 py-2 text-center shadow-lg backdrop-blur">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gold-300">{greeting.name}</span>
            <p className="mt-0.5 text-sm text-slate-200">&ldquo;{greeting.quip}&rdquo;</p>
          </div>
        </div>
      )}
    </div>
  );
}
