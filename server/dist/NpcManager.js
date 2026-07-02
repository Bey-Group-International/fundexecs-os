"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NpcManager = void 0;
const ROOM_W = 384;
const ROOM_H = 288;
const WALL_PAD = 32;
const NPC_SPEED = 40; // px/s
const TICK_MS = 100;
const ROOM_GRID = {
    ceo: { col: 0, row: 0 },
    boardroom: { col: 1, row: 0 },
    trading: { col: 2, row: 0 },
    research: { col: 0, row: 1 },
    office: { col: 1, row: 1 },
    ops: { col: 2, row: 1 },
    legal: { col: 0, row: 2 },
    marketing: { col: 1, row: 2 },
    reception: { col: 2, row: 2 },
};
const NPC_DEFS = [
    { id: "npc-earnest", name: "Earnest Fundmaker", spriteKey: "earnest-fundmaker", roomKey: "ceo" },
    { id: "npc-connector", name: "Capital Connector", spriteKey: "capital-connector", roomKey: "boardroom" },
    { id: "npc-deal", name: "Deal Sourcer", spriteKey: "deal-sourcer", roomKey: "trading" },
    { id: "npc-raiser", name: "Capital Raiser", spriteKey: "capital-raiser", roomKey: "research" },
    { id: "npc-ir", name: "Investor Relations", spriteKey: "investor-relations", roomKey: "office" },
    { id: "npc-automater", name: "Automater", spriteKey: "automater", roomKey: "ops" },
];
class NpcManager {
    constructor() {
        this.npcs = [];
        this.timer = null;
        for (const def of NPC_DEFS) {
            const grid = ROOM_GRID[def.roomKey];
            if (!grid)
                continue;
            const minX = grid.col * ROOM_W + WALL_PAD;
            const maxX = (grid.col + 1) * ROOM_W - WALL_PAD;
            const minY = grid.row * ROOM_H + WALL_PAD;
            const maxY = (grid.row + 1) * ROOM_H - WALL_PAD;
            const x = (minX + maxX) / 2;
            const y = (minY + maxY) / 2;
            this.npcs.push({
                npcId: def.id,
                name: def.name,
                spriteKey: def.spriteKey,
                x, y,
                facing: "idle",
                targetX: x,
                targetY: y,
                idleUntilMs: Date.now() + 1000 + Math.random() * 2000,
                minX, maxX, minY, maxY,
            });
        }
    }
    start(broadcast) {
        if (this.timer !== null)
            return;
        this.timer = setInterval(() => {
            const now = Date.now();
            const dt = TICK_MS / 1000;
            for (const npc of this.npcs) {
                if (now < npc.idleUntilMs) {
                    if (npc.facing !== "idle") {
                        npc.facing = "idle";
                        broadcast(this._stateMsg(npc));
                    }
                    continue;
                }
                const dx = npc.targetX - npc.x;
                const dy = npc.targetY - npc.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 4) {
                    // Arrived — idle then pick next target
                    npc.idleUntilMs = now + 1000 + Math.random() * 2000;
                    npc.targetX = npc.minX + Math.random() * (npc.maxX - npc.minX);
                    npc.targetY = npc.minY + Math.random() * (npc.maxY - npc.minY);
                    npc.facing = "idle";
                    broadcast(this._stateMsg(npc));
                    continue;
                }
                const step = Math.min(NPC_SPEED * dt, dist);
                npc.x += (dx / dist) * step;
                npc.y += (dy / dist) * step;
                npc.facing = Math.abs(dx) >= Math.abs(dy)
                    ? (dx > 0 ? "right" : "left")
                    : (dy > 0 ? "down" : "up");
                broadcast(this._stateMsg(npc));
            }
        }, TICK_MS);
    }
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    getSnapshot() {
        return this.npcs.map(({ npcId, x, y, facing, spriteKey, name }) => ({
            npcId, x, y, facing, spriteKey, name,
        }));
    }
    _stateMsg(npc) {
        return {
            type: "npc.state",
            npcId: npc.npcId,
            x: npc.x,
            y: npc.y,
            facing: npc.facing,
            spriteKey: npc.spriteKey,
            name: npc.name,
        };
    }
}
exports.NpcManager = NpcManager;
//# sourceMappingURL=NpcManager.js.map