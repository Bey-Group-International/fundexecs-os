import type { WebSocket } from "uWebSockets.js";
import type * as mediasoup from "mediasoup";
import { Room, type SocketData } from "./Room";
import type { PubSub } from "./PubSub";

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly pubsub: PubSub;
  private readonly worker: mediasoup.types.Worker;

  constructor(pubsub: PubSub, worker: mediasoup.types.Worker) {
    this.pubsub = pubsub;
    this.worker = worker;
  }

  async getOrCreateRoom(roomId: string): Promise<Room> {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, this.pubsub, this.worker);
      this.rooms.set(roomId, room);
      await this.pubsub.subscribeRoom(roomId);
    }
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  async removeEmptyRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (room && room.playerCount === 0) {
      this.rooms.delete(roomId);
      await this.pubsub.unsubscribeRoom(roomId);
    }
  }
}
