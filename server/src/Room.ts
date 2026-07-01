import type * as mediasoup from "mediasoup";
import type { WebSocket } from "uWebSockets.js";
import type { RemotePlayer, ServerMessage, Facing } from "@fundexecs/virtual-office-shared";
import { WORLD_W, WORLD_H, SPAWN_X, SPAWN_Y } from "@fundexecs/virtual-office-shared";
import type { PubSub } from "./PubSub";
import { BubbleManager, MESH_MAX } from "./BubbleManager";
import { SfuRoom } from "./SfuRoom";

const MAX_SPEED_PER_TICK = 8;

interface PlayerEntry {
  player: RemotePlayer;
  ws: WebSocket<SocketData>;
}

export interface SocketData {
  playerId: string;
  roomId: string;
}

export class Room {
  readonly roomId: string;
  private readonly players = new Map<string, PlayerEntry>();
  private readonly pubsub: PubSub;
  private readonly bubbles = new BubbleManager();
  private readonly worker: mediasoup.types.Worker;

  private sfuRooms = new Map<string, SfuRoom>();
  private sfuBubbles = new Set<string>();

  constructor(roomId: string, pubsub: PubSub, worker: mediasoup.types.Worker) {
    this.roomId = roomId;
    this.pubsub = pubsub;
    this.worker = worker;
  }

  addPlayer(
    ws: WebSocket<SocketData>,
    userId: string,
    displayName: string,
    spriteKey = "player_default"
  ): RemotePlayer {
    const player: RemotePlayer = {
      id: userId,
      x: SPAWN_X,
      y: SPAWN_Y,
      facing: "down",
      name: displayName,
      spriteKey,
    };
    this.players.set(userId, { player, ws });
    this.bubbles.addPlayer(userId, SPAWN_X, SPAWN_Y);
    return player;
  }

  removePlayer(playerId: string): void {
    // Remove from SFU rooms before removing from bubble tracking
    for (const [bubbleId, sfuRoom] of this.sfuRooms) {
      const closedProducerIds = sfuRoom.removePeer(playerId);
      for (const producerId of closedProducerIds) {
        this._broadcastSfuBubble(bubbleId, {
          type: "sfu.producer-closed",
          producerId,
          peerId: playerId,
        }, playerId);
      }
      if (sfuRoom.peerCount === 0) {
        sfuRoom.close();
        this.sfuRooms.delete(bubbleId);
        this.sfuBubbles.delete(bubbleId);
      }
    }

    this.players.delete(playerId);
    const events = this.bubbles.removePlayer(playerId);
    this._dispatchBubbleEvents(events);
  }

  getSnapshot(): RemotePlayer[] {
    return Array.from(this.players.values()).map((e) => ({ ...e.player }));
  }

  applyMove(playerId: string, dx: number, dy: number, seq: number): RemotePlayer | null {
    const entry = this.players.get(playerId);
    if (!entry) return null;

    const clampedDx = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dx));
    const clampedDy = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dy));

    const newX = Math.max(0, Math.min(WORLD_W, entry.player.x + clampedDx));
    const newY = Math.max(0, Math.min(WORLD_H, entry.player.y + clampedDy));

    let facing: Facing = entry.player.facing;
    if (clampedDx > 0) facing = "right";
    else if (clampedDx < 0) facing = "left";
    else if (clampedDy > 0) facing = "down";
    else if (clampedDy < 0) facing = "up";
    else facing = "idle";

    entry.player.x = newX;
    entry.player.y = newY;
    entry.player.facing = facing;

    const bubbleEvents = this.bubbles.updatePosition(playerId, newX, newY);
    this._dispatchBubbleEvents(bubbleEvents);

    return { ...entry.player };
  }

  // ─── SFU accessors ────────────────────────────────────────────────────────────

  getSfuRoomForPlayer(playerId: string): SfuRoom | null {
    const bubble = this.bubbles.getBubbleForPlayer(playerId);
    if (!bubble) return null;
    return this.sfuRooms.get(bubble.bubbleId) ?? null;
  }

  isBubbleSfu(playerId: string): boolean {
    const bubble = this.bubbles.getBubbleForPlayer(playerId);
    if (!bubble) return false;
    return this.sfuBubbles.has(bubble.bubbleId);
  }

  getBubbleMembers(playerId: string): string[] {
    return this.bubbles.getBubbleForPlayer(playerId)?.members ?? [];
  }

  broadcastToSfuBubble(playerId: string, message: ServerMessage, excludePlayerId?: string): void {
    const bubble = this.bubbles.getBubbleForPlayer(playerId);
    if (!bubble) return;
    this._broadcastSfuBubble(bubble.bubbleId, message, excludePlayerId);
  }

  private _broadcastSfuBubble(bubbleId: string, msg: ServerMessage, excludePlayerId?: string): void {
    const data = JSON.stringify(msg);
    for (const [id, entry] of this.players) {
      if (id === excludePlayerId) continue;
      const bid = this.bubbles.getBubbleForPlayer(id)?.bubbleId;
      if (bid !== bubbleId) continue;
      try { entry.ws.send(data, false); } catch { /* closing */ }
    }
  }

  // ─── Bubble event dispatch ────────────────────────────────────────────────────

  private _dispatchBubbleEvents(events: import("./BubbleManager").BubbleEvent[]): void {
    const grownBubbles = new Map<string, string[]>();

    for (const ev of events) {
      if (ev.type === "join") {
        this.sendTo(ev.memberId, { type: "bubble.join", bubbleId: ev.bubbleId, members: ev.allMembers });
        if (ev.allMembers.length > MESH_MAX) grownBubbles.set(ev.bubbleId, ev.allMembers);
      } else if (ev.type === "leave") {
        this.sendTo(ev.memberId, { type: "bubble.leave", bubbleId: ev.bubbleId });
      } else if (ev.type === "update") {
        this.sendTo(ev.memberId, { type: "bubble.update", bubbleId: ev.bubbleId, members: ev.allMembers });
        if (ev.allMembers.length > MESH_MAX) grownBubbles.set(ev.bubbleId, ev.allMembers);
      }
    }

    // Trigger SFU switch for bubbles crossing the mesh threshold
    for (const [bubbleId, members] of grownBubbles) {
      if (!this.sfuBubbles.has(bubbleId)) {
        this.sfuBubbles.add(bubbleId);
        this.sfuRooms.set(bubbleId, new SfuRoom(this.worker));
        const msg: ServerMessage = { type: "bubble.sfu-switch", bubbleId, members };
        for (const memberId of members) this.sendTo(memberId, msg);
      }
    }
  }

  // ─── Messaging helpers ────────────────────────────────────────────────────────

  broadcast(message: ServerMessage, excludePlayerId?: string): void {
    const data = JSON.stringify(message);
    for (const [id, entry] of this.players) {
      if (id === excludePlayerId) continue;
      try { entry.ws.send(data, false); } catch { /* closing */ }
    }
  }

  broadcastAll(message: ServerMessage): void {
    this.broadcast(message);
  }

  sendTo(playerId: string, message: ServerMessage): void {
    const entry = this.players.get(playerId);
    if (!entry) return;
    try { entry.ws.send(JSON.stringify(message), false); } catch { /* closing */ }
  }

  relayTo(targetId: string, message: ServerMessage): void {
    this.sendTo(targetId, message);
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  get playerCount(): number {
    return this.players.size;
  }
}
