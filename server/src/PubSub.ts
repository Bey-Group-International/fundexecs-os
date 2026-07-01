import Redis from "ioredis";
import type { ServerMessage } from "@fundexecs/virtual-office-shared";

export type RoomEventHandler = (roomId: string, message: ServerMessage) => void;

export class PubSub {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers: Set<RoomEventHandler> = new Set();

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl);
    this.sub = new Redis(redisUrl);

    this.sub.on("message", (channel: string, data: string) => {
      const prefix = "room:";
      if (!channel.startsWith(prefix)) return;
      const roomId = channel.slice(prefix.length);
      try {
        const message = JSON.parse(data) as ServerMessage;
        for (const handler of this.handlers) {
          handler(roomId, message);
        }
      } catch {
        // ignore malformed messages
      }
    });
  }

  async subscribeRoom(roomId: string): Promise<void> {
    await this.sub.subscribe(`room:${roomId}`);
  }

  async unsubscribeRoom(roomId: string): Promise<void> {
    await this.sub.unsubscribe(`room:${roomId}`);
  }

  async publish(roomId: string, message: ServerMessage): Promise<void> {
    await this.pub.publish(`room:${roomId}`, JSON.stringify(message));
  }

  onMessage(handler: RoomEventHandler): void {
    this.handlers.add(handler);
  }

  offMessage(handler: RoomEventHandler): void {
    this.handlers.delete(handler);
  }

  async disconnect(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}
