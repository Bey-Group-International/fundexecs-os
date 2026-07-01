import { Room } from "./Room";
import type { PubSub } from "./PubSub";
export declare class RoomManager {
    private readonly rooms;
    private readonly pubsub;
    constructor(pubsub: PubSub);
    getOrCreateRoom(roomId: string): Promise<Room>;
    getRoom(roomId: string): Room | undefined;
    removeEmptyRoom(roomId: string): Promise<void>;
}
