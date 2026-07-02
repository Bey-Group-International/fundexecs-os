import type { Facing, ServerMessage } from "@fundexecs/virtual-office-shared";
export type NpcData = {
    npcId: string;
    x: number;
    y: number;
    facing: Facing;
    spriteKey: string;
    name: string;
};
export declare class NpcManager {
    private readonly npcs;
    private timer;
    constructor();
    start(broadcast: (msg: ServerMessage) => void): void;
    stop(): void;
    getSnapshot(): NpcData[];
    private _stateMsg;
}
