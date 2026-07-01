export declare const BUBBLE_RADIUS = 160;
export declare const EXIT_RADIUS = 200;
export declare const MESH_MAX = 4;
export declare const BUBBLE_HARD_CAP = 20;
export interface BubbleEvent {
    type: "join" | "leave" | "update";
    bubbleId: string;
    memberId: string;
    allMembers: string[];
}
export declare class BubbleManager {
    private grid;
    private positions;
    private playerBubble;
    private bubbles;
    private cellKey;
    private toCell;
    private addToGrid;
    private removeFromGrid;
    private neighbours;
    addPlayer(id: string, x: number, y: number): void;
    /** Update position. Returns bubble events to broadcast. */
    updatePosition(id: string, x: number, y: number): BubbleEvent[];
    removePlayer(id: string): BubbleEvent[];
    private reconcile;
    private createBubble;
    private addToBubble;
    private tryMerge;
    private splitPair;
    private removeMemberFromBubble;
    getBubbleForPlayer(id: string): {
        bubbleId: string;
        members: string[];
    } | null;
}
