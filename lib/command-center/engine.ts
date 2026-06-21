// Command Center — deterministic simulation engine.
//
// Pure TypeScript (no DOM). Owns avatar positions/state and runs a scripted
// scenario timeline with approval + arrival gates that mirror the two product
// flows. The renderer reads `avatars` every frame; React subscribes to chat +
// status changes. A live-Earn adapter can drive the same primitives later by
// pushing the same step kinds instead of replaying a canned script.

import { findPath } from "./pathfinding";
import { cellCenter, ROOM_BY_ID, TILE } from "./map";
import { EARN_ID } from "./roster";
import type {
  AvatarDef,
  AvatarRuntime,
  AvatarState,
  ChatMessage,
  ChatRole,
  Facing,
  FlowKind,
  WorldMap,
  WorldStatus,
} from "./types";

const SPEED_TILES_PER_SEC = 5;
const WORK_DURATION_MS = 4200;
const STEP_GAP_MS = 750;

export type Step =
  | { kind: "phase"; label: string }
  | { kind: "say"; role: ChatRole; text: string; detail?: string[]; awaitsApproval?: boolean }
  | { kind: "gateApproval" }
  | { kind: "delegate"; who: string }
  | { kind: "assign"; who: string; room: string; standIndex: number; task: string }
  | { kind: "earnGoto"; room: string; standIndex: number; task: string }
  | { kind: "awaitArrivals" }
  | { kind: "awaitWork"; ms: number }
  | { kind: "wait"; ms: number }
  | { kind: "completeAll" }
  | { kind: "done" };

type Listener = () => void;

export class WorldEngine {
  readonly map: WorldMap;
  readonly avatars = new Map<string, AvatarRuntime>();

  private chat: ChatMessage[] = [];
  private steps: Step[] = [];
  private cursor = 0;
  private nextAt = 0;
  private clock = 0;
  private msgSeq = 0;

  private waitingApproval = false;
  private waitingArrivals = false;
  private workUntil = 0;
  private flow: FlowKind | null = null;
  private phase = "Standing by";
  private running = false;

  private listeners = new Set<Listener>();

  constructor(map: WorldMap, roster: AvatarDef[]) {
    this.map = map;
    for (const def of roster) {
      const { px, py } = cellCenter(def.spawn);
      this.avatars.set(def.id, {
        def,
        px,
        py,
        cell: { ...def.spawn },
        state: "idle",
        facing: "down",
        path: [],
        animClock: 0,
        task: null,
        progress: 0,
        pulse: 0,
      });
    }
  }

  // ---- subscription -------------------------------------------------------
  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit() {
    for (const cb of this.listeners) cb();
  }

  getChat(): ChatMessage[] {
    return this.chat;
  }
  getStatus(): WorldStatus {
    const active = [...this.avatars.values()]
      .filter((a) => a.state === "work" || a.task)
      .map((a) => a.def.id);
    return {
      flow: this.flow,
      phase: this.phase,
      running: this.running,
      awaitingApproval: this.waitingApproval,
      active,
    };
  }

  // ---- public controls ----------------------------------------------------
  startFlow(kind: FlowKind, steps: Step[]) {
    this.resetAvatars();
    this.chat = [];
    this.steps = steps;
    this.cursor = 0;
    this.nextAt = this.clock;
    this.flow = kind;
    this.running = true;
    this.waitingApproval = false;
    this.waitingArrivals = false;
    this.workUntil = 0;
    this.phase = "Reviewing request";
    this.emit();
  }

  approve() {
    if (this.waitingApproval) {
      this.waitingApproval = false;
      // Drop the approval affordance from the pending message.
      this.chat = this.chat.map((m) => ({ ...m, awaitsApproval: false }));
      this.nextAt = this.clock;
      this.emit();
    }
  }

  reset() {
    this.resetAvatars();
    this.chat = [];
    this.steps = [];
    this.cursor = 0;
    this.flow = null;
    this.running = false;
    this.waitingApproval = false;
    this.waitingArrivals = false;
    this.phase = "Standing by";
    this.emit();
  }

  private resetAvatars() {
    for (const a of this.avatars.values()) {
      const { px, py } = cellCenter(a.def.spawn);
      a.px = px;
      a.py = py;
      a.cell = { ...a.def.spawn };
      a.state = "idle";
      a.facing = "down";
      a.path = [];
      a.task = null;
      a.progress = 0;
      a.pulse = 0;
    }
  }

  // ---- per-frame update ---------------------------------------------------
  tick(dtMs: number) {
    this.clock += dtMs;
    this.updateAvatars(dtMs);
    this.runScenario();
  }

  private updateAvatars(dtMs: number) {
    const step = (SPEED_TILES_PER_SEC * TILE * dtMs) / 1000;
    for (const a of this.avatars.values()) {
      a.animClock += dtMs;
      if (a.pulse > 0) a.pulse = Math.max(0, a.pulse - dtMs / 600);

      if (a.path.length > 0) {
        a.state = "walk";
        const next = a.path[0];
        const { px: tx, py: ty } = cellCenter(next);
        const dx = tx - a.px;
        const dy = ty - a.py;
        const dist = Math.hypot(dx, dy);
        a.facing = facingFrom(dx, dy, a.facing);
        if (dist <= step) {
          a.px = tx;
          a.py = ty;
          a.cell = { ...next };
          a.path.shift();
          if (a.path.length === 0) {
            // Arrived: settle into the queued state.
            a.state = a.task ? "work" : "idle";
            a.progress = a.task ? 0 : a.progress;
          }
        } else {
          a.px += (dx / dist) * step;
          a.py += (dy / dist) * step;
        }
      } else if (a.state === "work") {
        a.progress = Math.min(1, a.progress + dtMs / WORK_DURATION_MS);
      }
    }
  }

  // ---- scenario runner ----------------------------------------------------
  private runScenario() {
    if (!this.running) return;
    if (this.waitingApproval) return;
    if (this.waitingArrivals) {
      const stillMoving = [...this.avatars.values()].some((a) => a.path.length > 0);
      if (stillMoving) return;
      this.waitingArrivals = false;
      this.nextAt = this.clock;
    }
    if (this.workUntil > 0) {
      if (this.clock < this.workUntil) return;
      this.workUntil = 0;
      this.nextAt = this.clock;
    }

    while (this.cursor < this.steps.length && this.clock >= this.nextAt) {
      const step = this.steps[this.cursor++];
      const blocked = this.execStep(step);
      if (blocked) break;
      this.nextAt = this.clock + STEP_GAP_MS;
    }

    if (this.cursor >= this.steps.length && this.running && !this.anyBusy()) {
      // Scenario exhausted — leave the world in its terminal state.
    }
  }

  private anyBusy(): boolean {
    return [...this.avatars.values()].some((a) => a.path.length > 0);
  }

  /** Returns true when the step blocks the runner (gate). */
  private execStep(step: Step): boolean {
    switch (step.kind) {
      case "phase":
        this.phase = step.label;
        this.emit();
        return false;
      case "say":
        this.pushMessage(step.role, step.text, step.detail, step.awaitsApproval);
        return false;
      case "gateApproval":
        this.waitingApproval = true;
        this.phase = "Awaiting your approval";
        this.emit();
        return true;
      case "delegate": {
        const earn = this.avatars.get(step.who);
        if (earn) {
          earn.state = "delegate";
          earn.pulse = 1;
          earn.animClock = 0;
        }
        this.phase = "Earn delegating";
        this.emit();
        return false;
      }
      case "assign": {
        this.sendToWork(step.who, step.room, step.standIndex, step.task);
        return false;
      }
      case "earnGoto": {
        this.sendToWork(EARN_ID, step.room, step.standIndex, step.task);
        this.phase = "Earn executing directly";
        this.emit();
        return false;
      }
      case "awaitArrivals":
        this.waitingArrivals = true;
        return true;
      case "awaitWork":
        this.workUntil = this.clock + step.ms;
        this.phase = "Executives executing";
        this.emit();
        return true;
      case "wait":
        this.nextAt = this.clock + step.ms;
        return true;
      case "completeAll": {
        for (const a of this.avatars.values()) {
          if (a.def.id === EARN_ID) {
            a.task = null;
            a.progress = 1;
            this.routeHome(a);
          } else if (a.task) {
            a.task = null;
            a.progress = 1;
            a.pulse = 1;
            this.routeHome(a);
          }
        }
        this.phase = "Workflow complete";
        this.emit();
        return false;
      }
      case "done":
        this.running = false;
        this.emit();
        return false;
      default:
        return false;
    }
  }

  private sendToWork(who: string, roomId: string, standIndex: number, task: string) {
    const a = this.avatars.get(who);
    const room = ROOM_BY_ID[roomId];
    if (!a || !room) return;
    const goal = room.stand[standIndex % room.stand.length] ?? room.stand[0];
    a.task = task;
    a.progress = 0;
    a.pulse = 1;
    const path = findPath(this.map.walkable, a.cell, goal);
    a.path = path;
    a.state = path.length ? "walk" : "work";
  }

  private routeHome(a: AvatarRuntime) {
    const path = findPath(this.map.walkable, a.cell, a.def.spawn);
    a.path = path;
    a.state = path.length ? "walk" : "idle";
  }

  private pushMessage(
    role: ChatRole,
    text: string,
    detail?: string[],
    awaitsApproval?: boolean,
  ) {
    this.chat = [
      ...this.chat,
      {
        id: `m${this.msgSeq++}`,
        role,
        text,
        detail,
        awaitsApproval,
        ts: Date.now(),
      },
    ];
    this.emit();
  }
}

function facingFrom(dx: number, dy: number, prev: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return prev;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export type { AvatarState };
