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
 *   • re-targets an actor when its `roomKey` changes — the renderer lerps it
 *     across the floor, so room transitions read as movement,
 *   • maps `state` to the renderer (emissive tint + animation clip), and
 *   • forwards avatar clicks as the same `{ npcId, spriteKey, name }` payload
 *     the Phaser office emits, so the agent inspector works unchanged.
 *
 * The heavy Three.js renderer is imported dynamically inside the effect, so it
 * never loads on the server or unless this view is actually shown.
 */

import { useEffect, useRef } from "react";
import type { OfficeRenderer } from "./render/OfficeRenderer";
import { AGENT_BY_ID, type AgentId } from "./program/officeProgram";
import {
  getOfficeProgramState,
  subscribeOfficeProgram,
  type OfficeProgramState,
} from "./program/officeProgramStore";
import { ROOMS, ROOM_W, ROOM_H } from "./types";

/** The click payload shape shared with the Phaser office (`onNpcClick`). */
export type NpcClickPayload = { npcId: string; spriteKey: string; name: string };

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
  useEffect(() => {
    onClickRef.current = onNpcClick;
  }, [onNpcClick]);

  useEffect(() => {
    if (!active) return;
    let renderer: OfficeRenderer | null = null;
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    const placed = new Set<string>();

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
            renderer!.moveActor(id, x, y); // lerped by the renderer → reads as movement
          }
          renderer!.setActorState(id, runtime.state);
        });
      }
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
      // The store notifies with no payload; pull the current snapshot each time.
      applyState(getOfficeProgramState());
      unsubscribe = subscribeOfficeProgram(() => applyState(getOfficeProgramState()));
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      renderer?.destroy();
      renderer = null;
    };
  }, [active]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
