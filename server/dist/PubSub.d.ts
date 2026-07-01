import type { ServerMessage } from "@fundexecs/virtual-office-shared";
export type RoomEventHandler = (roomId: string, message: ServerMessage) => void;
export declare class PubSub {
    private readonly pub;
    private readonly sub;
    private readonly handlers;
    constructor(redisUrl: string);
    subscribeRoom(roomId: string): Promise<void>;
    unsubscribeRoom(roomId: string): Promise<void>;
    publish(roomId: string, message: ServerMessage): Promise<void>;
    onMessage(handler: RoomEventHandler): void;
    offMessage(handler: RoomEventHandler): void;
    disconnect(): Promise<void>;
}
