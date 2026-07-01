import type { WebSocket } from "uWebSockets.js";
import type { RemotePlayer, ServerMessage } from "@fundexecs/virtual-office-shared";
import type { PubSub } from "./PubSub";
export interface SocketData {
    playerId: string;
    roomId: string;
}
export declare class Room {
    readonly roomId: string;
    private readonly players;
    private readonly pubsub;
    private readonly bubbles;
    constructor(roomId: string, pubsub: PubSub);
    addPlayer(ws: WebSocket<SocketData>, userId: string, displayName: string, spriteKey?: string): RemotePlayer;
    removePlayer(playerId: string): void;
    getSnapshot(): RemotePlayer[];
    applyMove(playerId: string, dx: number, dy: number, seq: number): RemotePlayer | null;
    private _dispatchBubbleEvents;
    broadcast(message: ServerMessage, excludePlayerId?: string): void;
    broadcastAll(message: ServerMessage): void;
    sendTo(playerId: string, message: ServerMessage): void;
    /** Relay a targeted signalling message (RTC) without modification */
    relayTo(targetId: string, message: ServerMessage): void;
    hasPlayer(playerId: string): boolean;
    get playerCount(): number;
}
