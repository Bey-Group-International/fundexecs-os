import type * as mediasoup from "mediasoup";
import { Room } from "./Room";
import type { PubSub } from "./PubSub";
export declare class RoomManager {
    private readonly rooms;
    private readonly pubsub;
    private readonly worker;
    constructor(pubsub: PubSub, worker: mediasoup.types.Worker);
    getOrCreateRoom(roomId: string): Promise<Room>;
    getRoom(roomId: string): Room | undefined;
    removeEmptyRoom(roomId: string): Promise<void>;
}
