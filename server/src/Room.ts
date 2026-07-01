import { v4 as uuidv4 } from "uuid";
import type { WebSocket } from "uWebSockets.js";
import type {
  RemotePlayer,
  ServerMessage,
  Facing,
} from "@fundexecs/virtual-office-shared";
import { WORLD_W, WORLD_H, SPAWN_X, SPAWN_Y } from "@fundexecs/virtual-office-shared";
import type { PubSub } from "./PubSub";

const MAX_SPEED_PER_TICK = 8; // pixels per message

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

  constructor(roomId: string, pubsub: PubSub) {
    this.roomId = roomId;
    this.pubsub = pubsub;
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
    return player;
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId);
  }

  getSnapshot(): RemotePlayer[] {
    return Array.from(this.players.values()).map((e) => ({ ...e.player }));
  }

  applyMove(
    playerId: string,
    dx: number,
    dy: number,
    seq: number
  ): RemotePlayer | null {
    const entry = this.players.get(playerId);
    if (!entry) return null;

    // Clamp delta to max speed
    const clampedDx = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dx));
    const clampedDy = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dy));

    const newX = Math.max(0, Math.min(WORLD_W, entry.player.x + clampedDx));
    const newY = Math.max(0, Math.min(WORLD_H, entry.player.y + clampedDy));

    // Determine facing direction
    let facing: Facing = entry.player.facing;
    if (clampedDx > 0) facing = "right";
    else if (clampedDx < 0) facing = "left";
    else if (clampedDy > 0) facing = "down";
    else if (clampedDy < 0) facing = "up";
    else facing = "idle";

    entry.player.x = newX;
    entry.player.y = newY;
    entry.player.facing = facing;

    return { ...entry.player };
  }

  broadcast(message: ServerMessage, excludePlayerId?: string): void {
    const data = JSON.stringify(message);
    for (const [id, entry] of this.players) {
      if (id === excludePlayerId) continue;
      try {
        entry.ws.send(data, false);
      } catch {
        // socket may be closing
      }
    }
  }

  broadcastAll(message: ServerMessage): void {
    this.broadcast(message);
  }

  sendTo(playerId: string, message: ServerMessage): void {
    const entry = this.players.get(playerId);
    if (!entry) return;
    try {
      entry.ws.send(JSON.stringify(message), false);
    } catch {
      // socket may be closing
    }
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  get playerCount(): number {
    return this.players.size;
  }
}
