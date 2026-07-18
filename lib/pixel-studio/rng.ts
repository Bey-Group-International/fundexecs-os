/**
 * Deterministic, seedable PRNG for reproducible avatar randomization.
 *
 * Uses mulberry32 — a small, fast, well-distributed 32-bit generator. The same
 * seed + same manifest version must always reproduce the same avatar, so this
 * intentionally avoids Math.random() entirely.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Normalize to a 32-bit unsigned integer; 0 is a valid seed.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick one element from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("SeededRng.pick: empty array");
    return items[this.int(0, items.length - 1)];
  }

  /** Coin flip with probability p of true. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Derive a fresh 32-bit seed from a string (FNV-1a). Stable across runs. */
export function seedFromString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
