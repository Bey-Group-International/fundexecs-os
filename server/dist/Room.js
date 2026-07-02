"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Room = void 0;
const virtual_office_shared_1 = require("@fundexecs/virtual-office-shared");
const ROOM_W = 384;
const ROOM_H = 288;
const ROOM_COLS = 4;
const ROOM_GRID = [
    "ceo", "boardroom", "trading", "research",
    "legal", "ops", "ops", "marketing",
    "investor", "reception", "reception", "",
];
function getRoomKey(x, y) {
    const col = Math.min(Math.floor(x / ROOM_W), ROOM_COLS - 1);
    const row = Math.min(Math.floor(y / ROOM_H), 2);
    return ROOM_GRID[row * ROOM_COLS + col] ?? "";
}
const BubbleManager_1 = require("./BubbleManager");
const SfuRoom_1 = require("./SfuRoom");
const NpcManager_1 = require("./NpcManager");
const MAX_SPEED_PER_TICK = 8;
class Room {
    constructor(roomId, pubsub, worker) {
        this.players = new Map();
        this.bubbles = new BubbleManager_1.BubbleManager();
        this.sfuRooms = new Map();
        this.sfuBubbles = new Set();
        this.playerRooms = new Map();
        this.occupancyCounts = {};
        this.roomId = roomId;
        this.pubsub = pubsub;
        this.worker = worker;
        this.npcManager = new NpcManager_1.NpcManager();
        this.npcManager.start((msg) => this.broadcastAll(msg));
    }
    getNpcSnapshot() {
        return this.npcManager.getSnapshot();
    }
    getOccupancy() {
        return { ...this.occupancyCounts };
    }
    _updateOccupancy(playerId, newRoomKey) {
        const oldRoomKey = this.playerRooms.get(playerId) ?? "";
        if (oldRoomKey === newRoomKey)
            return;
        const counts = { ...this.occupancyCounts };
        if (oldRoomKey)
            counts[oldRoomKey] = Math.max(0, (counts[oldRoomKey] ?? 0) - 1);
        if (newRoomKey)
            counts[newRoomKey] = (counts[newRoomKey] ?? 0) + 1;
        this.occupancyCounts = counts;
        if (newRoomKey)
            this.playerRooms.set(playerId, newRoomKey);
        else
            this.playerRooms.delete(playerId);
        this.broadcastAll({ type: "room.occupancy", counts });
    }
    close() {
        this.npcManager.stop();
        for (const sfuRoom of this.sfuRooms.values())
            sfuRoom.close();
        this.sfuRooms.clear();
        this.sfuBubbles.clear();
    }
    addPlayer(ws, userId, displayName, spriteKey = "player_default") {
        const player = {
            id: userId,
            x: virtual_office_shared_1.SPAWN_X,
            y: virtual_office_shared_1.SPAWN_Y,
            facing: "down",
            name: displayName,
            spriteKey,
        };
        this.bubbles.addPlayer(userId, virtual_office_shared_1.SPAWN_X, virtual_office_shared_1.SPAWN_Y);
        this._updateOccupancy(userId, getRoomKey(virtual_office_shared_1.SPAWN_X, virtual_office_shared_1.SPAWN_Y));
        this.players.set(userId, { player, ws });
        return player;
    }
    removePlayer(playerId) {
        // Remove from SFU rooms before removing from bubble tracking
        for (const [bubbleId, sfuRoom] of this.sfuRooms) {
            const closedProducerIds = sfuRoom.removePeer(playerId);
            for (const producerId of closedProducerIds) {
                this._broadcastSfuBubble(bubbleId, {
                    type: "sfu.producer-closed",
                    producerId,
                    peerId: playerId,
                }, playerId);
            }
            if (sfuRoom.peerCount === 0) {
                sfuRoom.close();
                this.sfuRooms.delete(bubbleId);
                this.sfuBubbles.delete(bubbleId);
            }
        }
        this._updateOccupancy(playerId, "");
        this.players.delete(playerId);
        const events = this.bubbles.removePlayer(playerId);
        this._dispatchBubbleEvents(events);
    }
    getSnapshot() {
        return Array.from(this.players.values()).map((e) => ({ ...e.player }));
    }
    applyMove(playerId, dx, dy, seq) {
        const entry = this.players.get(playerId);
        if (!entry)
            return null;
        const clampedDx = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dx));
        const clampedDy = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dy));
        const newX = Math.max(0, Math.min(virtual_office_shared_1.WORLD_W, entry.player.x + clampedDx));
        const newY = Math.max(0, Math.min(virtual_office_shared_1.WORLD_H, entry.player.y + clampedDy));
        let facing = entry.player.facing;
        if (clampedDx > 0)
            facing = "right";
        else if (clampedDx < 0)
            facing = "left";
        else if (clampedDy > 0)
            facing = "down";
        else if (clampedDy < 0)
            facing = "up";
        else
            facing = "idle";
        entry.player.x = newX;
        entry.player.y = newY;
        entry.player.facing = facing;
        const bubbleEvents = this.bubbles.updatePosition(playerId, newX, newY);
        this._dispatchBubbleEvents(bubbleEvents);
        this._updateOccupancy(playerId, getRoomKey(newX, newY));
        return { ...entry.player };
    }
    // ─── SFU accessors ────────────────────────────────────────────────────────────
    getSfuRoomForPlayer(playerId) {
        const bubble = this.bubbles.getBubbleForPlayer(playerId);
        if (!bubble)
            return null;
        return this.sfuRooms.get(bubble.bubbleId) ?? null;
    }
    isBubbleSfu(playerId) {
        const bubble = this.bubbles.getBubbleForPlayer(playerId);
        if (!bubble)
            return false;
        return this.sfuBubbles.has(bubble.bubbleId);
    }
    getBubbleMembers(playerId) {
        return this.bubbles.getBubbleForPlayer(playerId)?.members ?? [];
    }
    broadcastToSfuBubble(playerId, message, excludePlayerId) {
        const bubble = this.bubbles.getBubbleForPlayer(playerId);
        if (!bubble)
            return;
        this._broadcastSfuBubble(bubble.bubbleId, message, excludePlayerId);
    }
    _broadcastSfuBubble(bubbleId, msg, excludePlayerId) {
        const data = JSON.stringify(msg);
        for (const [id, entry] of this.players) {
            if (id === excludePlayerId)
                continue;
            const bid = this.bubbles.getBubbleForPlayer(id)?.bubbleId;
            if (bid !== bubbleId)
                continue;
            try {
                entry.ws.send(data, false);
            }
            catch { /* closing */ }
        }
    }
    // ─── Bubble event dispatch ────────────────────────────────────────────────────
    _dispatchBubbleEvents(events) {
        const grownBubbles = new Map();
        for (const ev of events) {
            if (ev.type === "join") {
                this.sendTo(ev.memberId, { type: "bubble.join", bubbleId: ev.bubbleId, members: ev.allMembers });
                if (ev.allMembers.length > BubbleManager_1.MESH_MAX)
                    grownBubbles.set(ev.bubbleId, ev.allMembers);
            }
            else if (ev.type === "leave") {
                this.sendTo(ev.memberId, { type: "bubble.leave", bubbleId: ev.bubbleId });
            }
            else if (ev.type === "update") {
                this.sendTo(ev.memberId, { type: "bubble.update", bubbleId: ev.bubbleId, members: ev.allMembers });
                if (ev.allMembers.length > BubbleManager_1.MESH_MAX)
                    grownBubbles.set(ev.bubbleId, ev.allMembers);
            }
        }
        // Trigger SFU switch for bubbles crossing the mesh threshold
        for (const [bubbleId, members] of grownBubbles) {
            if (!this.sfuBubbles.has(bubbleId)) {
                this.sfuBubbles.add(bubbleId);
                this.sfuRooms.set(bubbleId, new SfuRoom_1.SfuRoom(this.worker));
                const msg = { type: "bubble.sfu-switch", bubbleId, members };
                for (const memberId of members)
                    this.sendTo(memberId, msg);
            }
        }
    }
    // ─── Messaging helpers ────────────────────────────────────────────────────────
    broadcast(message, excludePlayerId) {
        const data = JSON.stringify(message);
        for (const [id, entry] of this.players) {
            if (id === excludePlayerId)
                continue;
            try {
                entry.ws.send(data, false);
            }
            catch { /* closing */ }
        }
    }
    broadcastAll(message) {
        this.broadcast(message);
    }
    sendTo(playerId, message) {
        const entry = this.players.get(playerId);
        if (!entry)
            return;
        try {
            entry.ws.send(JSON.stringify(message), false);
        }
        catch { /* closing */ }
    }
    relayTo(targetId, message) {
        this.sendTo(targetId, message);
    }
    hasPlayer(playerId) {
        return this.players.has(playerId);
    }
    get playerCount() {
        return this.players.size;
    }
}
exports.Room = Room;
//# sourceMappingURL=Room.js.map