"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Room = void 0;
const virtual_office_shared_1 = require("@fundexecs/virtual-office-shared");
const BubbleManager_1 = require("./BubbleManager");
const SfuRoom_1 = require("./SfuRoom");
const MAX_SPEED_PER_TICK = 8;
class Room {
    constructor(roomId, pubsub, worker) {
        this.players = new Map();
        this.bubbles = new BubbleManager_1.BubbleManager();
        this.sfuRooms = new Map();
        this.sfuBubbles = new Set();
        this.roomId = roomId;
        this.pubsub = pubsub;
        this.worker = worker;
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
        this.players.set(userId, { player, ws });
        this.bubbles.addPlayer(userId, virtual_office_shared_1.SPAWN_X, virtual_office_shared_1.SPAWN_Y);
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