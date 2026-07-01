import { v4 as uuidv4 } from "uuid";

export const BUBBLE_RADIUS = 160;
export const EXIT_RADIUS = 200; // BUBBLE_RADIUS + HYSTERESIS
export const MAX_BUBBLE_SIZE = 4;
const CELL_SIZE = BUBBLE_RADIUS; // coarse grid cell

interface PlayerPos {
  id: string;
  x: number;
  y: number;
}

interface Bubble {
  id: string;
  members: Set<string>;
}

export interface BubbleEvent {
  type: "join" | "leave" | "update";
  bubbleId: string;
  memberId: string;
  allMembers: string[];
}

export class BubbleManager {
  // spatial cell → player ids
  private grid = new Map<string, Set<string>>();
  // player id → position
  private positions = new Map<string, PlayerPos>();
  // player id → bubble id
  private playerBubble = new Map<string, string>();
  // bubble id → bubble
  private bubbles = new Map<string, Bubble>();

  private cellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private toCell(x: number, y: number): [number, number] {
    return [Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE)];
  }

  private addToGrid(id: string, x: number, y: number): void {
    const [cx, cy] = this.toCell(x, y);
    const key = this.cellKey(cx, cy);
    if (!this.grid.has(key)) this.grid.set(key, new Set());
    this.grid.get(key)!.add(id);
  }

  private removeFromGrid(id: string, x: number, y: number): void {
    const [cx, cy] = this.toCell(x, y);
    const key = this.cellKey(cx, cy);
    this.grid.get(key)?.delete(id);
  }

  private neighbours(x: number, y: number): string[] {
    const [cx, cy] = this.toCell(x, y);
    const result: string[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.grid.get(this.cellKey(cx + dx, cy + dy));
        if (cell) for (const id of cell) result.push(id);
      }
    }
    return result;
  }

  addPlayer(id: string, x: number, y: number): void {
    this.positions.set(id, { id, x, y });
    this.addToGrid(id, x, y);
  }

  /** Update position. Returns bubble events to broadcast. */
  updatePosition(id: string, x: number, y: number): BubbleEvent[] {
    const prev = this.positions.get(id);
    if (!prev) return [];

    // Update grid
    this.removeFromGrid(id, prev.x, prev.y);
    prev.x = x;
    prev.y = y;
    this.addToGrid(id, x, y);

    return this.reconcile(id);
  }

  removePlayer(id: string): BubbleEvent[] {
    const pos = this.positions.get(id);
    if (pos) {
      this.removeFromGrid(id, pos.x, pos.y);
      this.positions.delete(id);
    }
    return this.removeMemberFromBubble(id);
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private reconcile(id: string): BubbleEvent[] {
    const pos = this.positions.get(id)!;
    const events: BubbleEvent[] = [];

    // 1. Find close players (within BUBBLE_RADIUS)
    const close = new Set<string>();
    for (const nid of this.neighbours(pos.x, pos.y)) {
      if (nid === id) continue;
      const npos = this.positions.get(nid);
      if (!npos) continue;
      const dist = Math.hypot(npos.x - pos.x, npos.y - pos.y);
      if (dist <= BUBBLE_RADIUS) close.add(nid);
    }

    // 2. Remove from bubble if all current partners drifted out
    const myBubbleId = this.playerBubble.get(id);
    if (myBubbleId) {
      const bubble = this.bubbles.get(myBubbleId)!;
      const farPartners: string[] = [];
      for (const mid of bubble.members) {
        if (mid === id) continue;
        const mpos = this.positions.get(mid);
        if (!mpos) { farPartners.push(mid); continue; }
        const dist = Math.hypot(mpos.x - pos.x, mpos.y - pos.y);
        if (dist > EXIT_RADIUS) farPartners.push(mid);
      }
      for (const fid of farPartners) {
        events.push(...this.splitPair(id, fid));
      }
    }

    // 3. Add close players not yet in my bubble
    for (const cid of close) {
      const myBid = this.playerBubble.get(id);
      const theirBid = this.playerBubble.get(cid);

      if (myBid === theirBid && myBid !== undefined) continue; // already together

      if (!myBid && !theirBid) {
        // Both alone — form new bubble
        events.push(...this.createBubble(id, cid));
      } else if (myBid && !theirBid) {
        const bubble = this.bubbles.get(myBid)!;
        if (bubble.members.size < MAX_BUBBLE_SIZE) {
          events.push(...this.addToBubble(myBid, cid));
        }
      } else if (!myBid && theirBid) {
        const bubble = this.bubbles.get(theirBid)!;
        if (bubble.members.size < MAX_BUBBLE_SIZE) {
          events.push(...this.addToBubble(theirBid, id));
        }
      } else if (myBid && theirBid) {
        // Different bubbles — merge smaller into larger if room
        events.push(...this.tryMerge(myBid, theirBid));
      }
    }

    return events;
  }

  private createBubble(a: string, b: string): BubbleEvent[] {
    const bubbleId = uuidv4();
    const bubble: Bubble = { id: bubbleId, members: new Set([a, b]) };
    this.bubbles.set(bubbleId, bubble);
    this.playerBubble.set(a, bubbleId);
    this.playerBubble.set(b, bubbleId);
    const members = [a, b];
    return [
      { type: "join", bubbleId, memberId: a, allMembers: members },
      { type: "join", bubbleId, memberId: b, allMembers: members },
    ];
  }

  private addToBubble(bubbleId: string, newMember: string): BubbleEvent[] {
    const bubble = this.bubbles.get(bubbleId);
    if (!bubble) return [];
    bubble.members.add(newMember);
    this.playerBubble.set(newMember, bubbleId);
    const members = Array.from(bubble.members);
    const events: BubbleEvent[] = [
      { type: "join", bubbleId, memberId: newMember, allMembers: members },
    ];
    for (const mid of bubble.members) {
      if (mid === newMember) continue;
      events.push({ type: "update", bubbleId, memberId: mid, allMembers: members });
    }
    return events;
  }

  private tryMerge(bidA: string, bidB: string): BubbleEvent[] {
    const a = this.bubbles.get(bidA)!;
    const b = this.bubbles.get(bidB)!;
    if (a.members.size + b.members.size > MAX_BUBBLE_SIZE) return [];

    // Merge b into a
    const events: BubbleEvent[] = [];
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
      if (joining.includes(mid)) continue;
      events.push({ type: "update", bubbleId: bidA, memberId: mid, allMembers: members });
    }
    return events;
  }

  private splitPair(aid: string, bid: string): BubbleEvent[] {
    const bubbleId = this.playerBubble.get(aid);
    if (!bubbleId) return [];
    const bubble = this.bubbles.get(bubbleId);
    if (!bubble) return [];

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
    const events: BubbleEvent[] = [
      { type: "leave", bubbleId, memberId: bid, allMembers: [] },
    ];
    for (const mid of members) {
      events.push({ type: "update", bubbleId, memberId: mid, allMembers: members });
    }
    return events;
  }

  private removeMemberFromBubble(id: string): BubbleEvent[] {
    const bubbleId = this.playerBubble.get(id);
    if (!bubbleId) return [];
    this.playerBubble.delete(id);
    const bubble = this.bubbles.get(bubbleId);
    if (!bubble) return [];
    bubble.members.delete(id);

    if (bubble.members.size < 2) {
      // Dissolve
      const remaining = Array.from(bubble.members);
      this.bubbles.delete(bubbleId);
      for (const mid of remaining) this.playerBubble.delete(mid);
      const events: BubbleEvent[] = [
        { type: "leave", bubbleId, memberId: id, allMembers: [] },
      ];
      for (const mid of remaining) {
        events.push({ type: "leave", bubbleId, memberId: mid, allMembers: [] });
      }
      return events;
    }

    const members = Array.from(bubble.members);
    const events: BubbleEvent[] = [
      { type: "leave", bubbleId, memberId: id, allMembers: [] },
    ];
    for (const mid of members) {
      events.push({ type: "update", bubbleId, memberId: mid, allMembers: members });
    }
    return events;
  }

  getBubbleForPlayer(id: string): { bubbleId: string; members: string[] } | null {
    const bubbleId = this.playerBubble.get(id);
    if (!bubbleId) return null;
    const bubble = this.bubbles.get(bubbleId);
    if (!bubble) return null;
    return { bubbleId, members: Array.from(bubble.members) };
  }
}
