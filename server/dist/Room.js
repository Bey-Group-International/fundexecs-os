"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Room = void 0;
const virtual_office_shared_1 = require("@fundexecs/virtual-office-shared");
const BubbleManager_1 = require("./BubbleManager");
const MAX_SPEED_PER_TICK = 8; // pixels per message
class Room {
    constructor(roomId, pubsub) {
        this.players = new Map();
        this.bubbles = new BubbleManager_1.BubbleManager();
        this.roomId = roomId;
        this.pubsub = pubsub;
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
        // Clamp delta to max speed
        const clampedDx = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dx));
        const clampedDy = Math.max(-MAX_SPEED_PER_TICK, Math.min(MAX_SPEED_PER_TICK, dy));
        const newX = Math.max(0, Math.min(virtual_office_shared_1.WORLD_W, entry.player.x + clampedDx));
        const newY = Math.max(0, Math.min(virtual_office_shared_1.WORLD_H, entry.player.y + clampedDy));
        // Determine facing direction
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
        // Update bubble spatial index
        const bubbleEvents = this.bubbles.updatePosition(playerId, newX, newY);
        this._dispatchBubbleEvents(bubbleEvents);
        return { ...entry.player };
    }
    _dispatchBubbleEvents(events) {
        for (const ev of events) {
            if (ev.type === "join") {
                this.sendTo(ev.memberId, {
                    type: "bubble.join",
                    bubbleId: ev.bubbleId,
                    members: ev.allMembers,
                });
            }
            else if (ev.type === "leave") {
                this.sendTo(ev.memberId, {
                    type: "bubble.leave",
                    bubbleId: ev.bubbleId,
                });
            }
            else if (ev.type === "update") {
                this.sendTo(ev.memberId, {
                    type: "bubble.update",
                    bubbleId: ev.bubbleId,
                    members: ev.allMembers,
                });
            }
        }
    }
    broadcast(message, excludePlayerId) {
        const data = JSON.stringify(message);
        for (const [id, entry] of this.players) {
            if (id === excludePlayerId)
                continue;
            try {
                entry.ws.send(data, false);
            }
            catch {
                // socket may be closing
            }
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
        catch {
            // socket may be closing
        }
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