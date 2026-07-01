"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BubbleManager = exports.BUBBLE_HARD_CAP = exports.MESH_MAX = exports.EXIT_RADIUS = exports.BUBBLE_RADIUS = void 0;
const uuid_1 = require("uuid");
exports.BUBBLE_RADIUS = 160;
exports.EXIT_RADIUS = 200; // BUBBLE_RADIUS + HYSTERESIS
exports.MESH_MAX = 4; // P2P mesh up to this size
exports.BUBBLE_HARD_CAP = 20; // absolute maximum per bubble
const CELL_SIZE = exports.BUBBLE_RADIUS; // coarse grid cell
class BubbleManager {
    constructor() {
        // spatial cell → player ids
        this.grid = new Map();
        // player id → position
        this.positions = new Map();
        // player id → bubble id
        this.playerBubble = new Map();
        // bubble id → bubble
        this.bubbles = new Map();
    }
    cellKey(cx, cy) {
        return `${cx},${cy}`;
    }
    toCell(x, y) {
        return [Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE)];
    }
    addToGrid(id, x, y) {
        const [cx, cy] = this.toCell(x, y);
        const key = this.cellKey(cx, cy);
        if (!this.grid.has(key))
            this.grid.set(key, new Set());
        this.grid.get(key).add(id);
    }
    removeFromGrid(id, x, y) {
        const [cx, cy] = this.toCell(x, y);
        const key = this.cellKey(cx, cy);
        this.grid.get(key)?.delete(id);
    }
    neighbours(x, y) {
        const [cx, cy] = this.toCell(x, y);
        const result = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const cell = this.grid.get(this.cellKey(cx + dx, cy + dy));
                if (cell)
                    for (const id of cell)
                        result.push(id);
            }
        }
        return result;
    }
    addPlayer(id, x, y) {
        this.positions.set(id, { id, x, y });
        this.addToGrid(id, x, y);
    }
    /** Update position. Returns bubble events to broadcast. */
    updatePosition(id, x, y) {
        const prev = this.positions.get(id);
        if (!prev)
            return [];
        // Update grid
        this.removeFromGrid(id, prev.x, prev.y);
        prev.x = x;
        prev.y = y;
        this.addToGrid(id, x, y);
        return this.reconcile(id);
    }
    removePlayer(id) {
        const pos = this.positions.get(id);
        if (pos) {
            this.removeFromGrid(id, pos.x, pos.y);
            this.positions.delete(id);
        }
        return this.removeMemberFromBubble(id);
    }
    // ─── Private ─────────────────────────────────────────────────────────────────
    reconcile(id) {
        const pos = this.positions.get(id);
        const events = [];
        // 1. Find close players (within BUBBLE_RADIUS)
        const close = new Set();
        for (const nid of this.neighbours(pos.x, pos.y)) {
            if (nid === id)
                continue;
            const npos = this.positions.get(nid);
            if (!npos)
                continue;
            const dist = Math.hypot(npos.x - pos.x, npos.y - pos.y);
            if (dist <= exports.BUBBLE_RADIUS)
                close.add(nid);
        }
        // 2. Remove from bubble if all current partners drifted out
        const myBubbleId = this.playerBubble.get(id);
        if (myBubbleId) {
            const bubble = this.bubbles.get(myBubbleId);
            const farPartners = [];
            for (const mid of bubble.members) {
                if (mid === id)
                    continue;
                const mpos = this.positions.get(mid);
                if (!mpos) {
                    farPartners.push(mid);
                    continue;
                }
                const dist = Math.hypot(mpos.x - pos.x, mpos.y - pos.y);
                if (dist > exports.EXIT_RADIUS)
                    farPartners.push(mid);
            }
            for (const fid of farPartners) {
                events.push(...this.splitPair(id, fid));
            }
        }
        // 3. Add close players not yet in my bubble
        for (const cid of close) {
            const myBid = this.playerBubble.get(id);
            const theirBid = this.playerBubble.get(cid);
            if (myBid === theirBid && myBid !== undefined)
                continue; // already together
            if (!myBid && !theirBid) {
                // Both alone — form new bubble
                events.push(...this.createBubble(id, cid));
            }
            else if (myBid && !theirBid) {
                const bubble = this.bubbles.get(myBid);
                if (bubble.members.size < exports.BUBBLE_HARD_CAP) {
                    events.push(...this.addToBubble(myBid, cid));
                }
            }
            else if (!myBid && theirBid) {
                const bubble = this.bubbles.get(theirBid);
                if (bubble.members.size < exports.BUBBLE_HARD_CAP) {
                    events.push(...this.addToBubble(theirBid, id));
                }
            }
            else if (myBid && theirBid) {
                // Different bubbles — merge smaller into larger if room
                events.push(...this.tryMerge(myBid, theirBid));
            }
        }
        return events;
    }
    createBubble(a, b) {
        const bubbleId = (0, uuid_1.v4)();
        const bubble = { id: bubbleId, members: new Set([a, b]) };
        this.bubbles.set(bubbleId, bubble);
        this.playerBubble.set(a, bubbleId);
        this.playerBubble.set(b, bubbleId);
        const members = [a, b];
        return [
            { type: "join", bubbleId, memberId: a, allMembers: members },
            { type: "join", bubbleId, memberId: b, allMembers: members },
        ];
    }
    addToBubble(bubbleId, newMember) {
        const bubble = this.bubbles.get(bubbleId);
        if (!bubble)
            return [];
        bubble.members.add(newMember);
        this.playerBubble.set(newMember, bubbleId);
        const members = Array.from(bubble.members);
        const events = [
            { type: "join", bubbleId, memberId: newMember, allMembers: members },
        ];
        for (const mid of bubble.members) {
            if (mid === newMember)
                continue;
            events.push({ type: "update", bubbleId, memberId: mid, allMembers: members });
        }
        return events;
    }
    tryMerge(bidA, bidB) {
        const a = this.bubbles.get(bidA);
        const b = this.bubbles.get(bidB);
        if (a.members.size + b.members.size > exports.BUBBLE_HARD_CAP)
            return [];
        // Merge b into a
        const events = [];
        const joining = Array.from(b.members);
        for (const mid of joining) {
            b.members.delete(mid);
            a.members.add(mid);
            this.playerBubble.set(mid, bidA);
        }
        this.bubbles.delete(bidB);
        const members = Array.from(a.members);
        for (const mid of joining) {
            events.push({ type: "join", bubbleId: bidA, memberId: mid, allMembers: members });
        }
        for (const mid of a.members) {
            if (joining.includes(mid))
                continue;
            events.push({ type: "update", bubbleId: bidA, memberId: mid, allMembers: members });
        }
        return events;
    }
    splitPair(aid, bid) {
        const bubbleId = this.playerBubble.get(aid);
        if (!bubbleId)
            return [];
        const bubble = this.bubbles.get(bubbleId);
        if (!bubble)
            return [];
        if (bubble.members.size === 2) {
            // Dissolve the bubble entirely
            this.bubbles.delete(bubbleId);
            this.playerBubble.delete(aid);
            this.playerBubble.delete(bid);
            return [
                { type: "leave", bubbleId, memberId: aid, allMembers: [] },
                { type: "leave", bubbleId, memberId: bid, allMembers: [] },
            ];
        }
        // Remove only bid
        bubble.members.delete(bid);
        this.playerBubble.delete(bid);
        const members = Array.from(bubble.members);
        const events = [
            { type: "leave", bubbleId, memberId: bid, allMembers: [] },
        ];
        for (const mid of members) {
            events.push({ type: "update", bubbleId, memberId: mid, allMembers: members });
        }
        return events;
    }
    removeMemberFromBubble(id) {
        const bubbleId = this.playerBubble.get(id);
        if (!bubbleId)
            return [];
        this.playerBubble.delete(id);
        const bubble = this.bubbles.get(bubbleId);
        if (!bubble)
            return [];
        bubble.members.delete(id);
        if (bubble.members.size < 2) {
            // Dissolve
            const remaining = Array.from(bubble.members);
            this.bubbles.delete(bubbleId);
            for (const mid of remaining)
                this.playerBubble.delete(mid);
            const events = [
                { type: "leave", bubbleId, memberId: id, allMembers: [] },
            ];
            for (const mid of remaining) {
                events.push({ type: "leave", bubbleId, memberId: mid, allMembers: [] });
            }
            return events;
        }
        const members = Array.from(bubble.members);
        const events = [
            { type: "leave", bubbleId, memberId: id, allMembers: [] },
        ];
        for (const mid of members) {
            events.push({ type: "update", bubbleId, memberId: mid, allMembers: members });
        }
        return events;
    }
    getBubbleForPlayer(id) {
        const bubbleId = this.playerBubble.get(id);
        if (!bubbleId)
            return null;
        const bubble = this.bubbles.get(bubbleId);
        if (!bubble)
            return null;
        return { bubbleId, members: Array.from(bubble.members) };
    }
}
exports.BubbleManager = BubbleManager;
//# sourceMappingURL=BubbleManager.js.map