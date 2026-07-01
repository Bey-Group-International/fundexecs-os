import type * as mediasoup from "mediasoup";
import type { WebSocket } from "uWebSockets.js";
import type { RemotePlayer, ServerMessage } from "@fundexecs/virtual-office-shared";
import type { PubSub } from "./PubSub";
import { SfuRoom } from "./SfuRoom";
import type { NpcData } from "./NpcManager";
export interface SocketData {
    playerId: string;
    roomId: string;
    displayName: string;
    characterId: string;
}
export declare class Room {
    readonly roomId: string;
    private readonly players;
    private readonly pubsub;
    private readonly bubbles;
    private readonly worker;
    private sfuRooms;
    private sfuBubbles;
    private readonly npcManager;
    private readonly playerRooms;
    private occupancyCounts;
    constructor(roomId: string, pubsub: PubSub, worker: mediasoup.types.Worker);
    getNpcSnapshot(): NpcData[];
    getOccupancy(): Record<string, number>;
    private _updateOccupancy;
    close(): void;
    addPlayer(ws: WebSocket<SocketData>, userId: string, displayName: string, spriteKey?: string): RemotePlayer;
    removePlayer(playerId: string): void;
    getSnapshot(): RemotePlayer[];
    applyMove(playerId: string, dx: number, dy: number, seq: number): RemotePlayer | null;
    getSfuRoomForPlayer(playerId: string): SfuRoom | null;
    isBubbleSfu(playerId: string): boolean;
    getBubbleMembers(playerId: string): string[];
    broadcastToSfuBubble(playerId: string, message: ServerMessage, excludePlayerId?: string): void;
    private _broadcastSfuBubble;
    private _dispatchBubbleEvents;
    broadcast(message: ServerMessage, excludePlayerId?: string): void;
    broadcastAll(message: ServerMessage): void;
    sendTo(playerId: string, message: ServerMessage): void;
    relayTo(targetId: string, message: ServerMessage): void;
    hasPlayer(playerId: string): boolean;
    get playerCount(): number;
}
